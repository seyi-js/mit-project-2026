// KAN-47: runs the full experiment — all 4 strategies x 10 repetitions each
// (Section 9), by calling runExperiment() 40 times with runIds like
// "adaptive-health-scored-run-7". `npm run experiment:all [-- transactionCount]`.
// Needs MongoDB + the provider simulators running, same as runOne.js.
//
// RESUMABLE: before each of the 40, it checks TransactionLog for that runId.
// Already has >= transactionsPerRun docs -> fully done, skip it. Has SOME
// but not enough -> a previous attempt was interrupted mid-run; those
// partial docs are deleted and the run redone from scratch (transactionIndex
// 0 again) rather than resumed mid-stream, since resuming would also require
// restoring the exact ProviderHealth/CircuitBreakerState at the point of
// interruption, which isn't tracked. This means Ctrl+C / a crash / closing
// the laptop mid-batch is always safe to recover from by just re-running
// this script — nothing gets silently duplicated or corrupted.
require('dotenv').config();
const { connectDB, disconnectDB } = require('../config/db');
const TransactionLog = require('../models/TransactionLog');
const { runExperiment } = require('./experimentRunner');
const { ROUTING_STRATEGIES, RUNS_PER_STRATEGY, TRANSACTIONS_PER_RUN } = require('../config/constants');

async function main() {
  const transactionsArg = process.argv[2];
  const transactionsPerRun = transactionsArg ? Number(transactionsArg) : TRANSACTIONS_PER_RUN;
  const providersBaseUrl = `http://127.0.0.1:${process.env.PROVIDERS_PORT || 4000}`;

  await connectDB();

  const totalRuns = ROUTING_STRATEGIES.length * RUNS_PER_STRATEGY;
  let runNumber = 0;
  const batchStartedAt = Date.now();

  console.log(
    `Running ${totalRuns} experiment runs (${ROUTING_STRATEGIES.length} strategies x ${RUNS_PER_STRATEGY} runs), ${transactionsPerRun} transactions each.`
  );
  console.log(`Providers: ${providersBaseUrl}`);

  for (const strategyName of ROUTING_STRATEGIES) {
    for (let repetition = 1; repetition <= RUNS_PER_STRATEGY; repetition += 1) {
      const runId = `${strategyName}-run-${repetition}`;
      runNumber += 1;

      // eslint-disable-next-line no-await-in-loop
      const existingCount = await TransactionLog.countDocuments({ runId });
      if (existingCount >= transactionsPerRun) {
        console.log(`[${runNumber}/${totalRuns}] ${runId} already complete, skipping.`);
        continue;
      }
      if (existingCount > 0) {
        console.log(`[${runNumber}/${totalRuns}] ${runId} has ${existingCount} partial transactions, clearing and redoing from scratch.`);
        // eslint-disable-next-line no-await-in-loop
        await TransactionLog.deleteMany({ runId });
      }

      const runStartedAt = Date.now();
      console.log(`[${runNumber}/${totalRuns}] Starting ${runId}...`);

      // eslint-disable-next-line no-await-in-loop
      await runExperiment({
        strategyName,
        runId,
        transactionsPerRun,
        providersBaseUrl,
        onProgress: ({ transactionIndex, transactionsPerRun: total }) => {
          console.log(`    ...${runId}: ${transactionIndex}/${total}`);
        },
      });

      const runElapsedSec = ((Date.now() - runStartedAt) / 1000).toFixed(1);
      console.log(`[${runNumber}/${totalRuns}] Finished ${runId} in ${runElapsedSec}s`);
    }
  }

  const totalElapsedMin = ((Date.now() - batchStartedAt) / 60000).toFixed(1);
  console.log(`All ${totalRuns} runs complete in ${totalElapsedMin} minutes.`);

  await disconnectDB();
}

main().catch((err) => {
  console.error('Experiment batch failed (re-run this script to resume from where it left off):', err);
  process.exit(1);
});
