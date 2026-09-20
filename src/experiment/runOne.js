// Manual single-run CLI: `npm run experiment -- <strategy> [transactionCount]`.
// Only needs MongoDB + the provider simulators (npm run start:providers)
// running — NOT the orchestration Express server, since this calls
// runExperiment() directly in-process. Useful for a quick one-off dry run;
// runAll.js is what actually does all 40 for the real experiment.
require('dotenv').config();
const { connectDB, disconnectDB } = require('../config/db');
const { runExperiment } = require('./experimentRunner');

async function main() {
  const [, , strategyName, transactionsArg] = process.argv;
  if (!strategyName) {
    console.error('Usage: node src/experiment/runOne.js <strategyName> [transactionsPerRun]');
    process.exit(1);
  }

  await connectDB();

  const runId = `${strategyName}-manual-${Date.now()}`;
  const transactionsPerRun = transactionsArg ? Number(transactionsArg) : undefined;
  const providersBaseUrl = `http://127.0.0.1:${process.env.PROVIDERS_PORT || 4000}`;

  console.log(`Starting run ${runId} against ${providersBaseUrl}...`);
  const result = await runExperiment({
    strategyName,
    runId,
    transactionsPerRun,
    providersBaseUrl,
    onProgress: ({ transactionIndex, transactionsPerRun: total }) => {
      console.log(`  ...${transactionIndex}/${total}`);
    },
  });
  console.log('Done:', result);

  await disconnectDB();
}

main().catch((err) => {
  console.error('Experiment run failed:', err);
  process.exit(1);
});
