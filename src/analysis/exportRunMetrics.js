// Computes the 6 dependent variables for every logged run and writes them to
// analysis/run_metrics.json, which analysis/statistics.py then reads.
//
// Split this way deliberately: metric computation stays in Node so it reuses
// the real HealthScore formulas, while the statistical tests live in Python
// where scipy provides citable, battle-tested implementations of
// Shapiro-Wilk / t-test / Mann-Whitney U.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDB, disconnectDB } = require('../config/db');
const TransactionLog = require('../models/TransactionLog');
const FaultSchedule = require('../models/FaultSchedule');
const { computeRunMetrics } = require('./metrics');
const { DEFAULT_SCHEDULE_ID } = require('../experiment/faultSchedule');
const { ROUTING_STRATEGIES, DEGRADATION_THRESHOLD_DEFAULT } = require('../config/constants');

async function main() {
  const threshold = process.argv[2] ? Number(process.argv[2]) : DEGRADATION_THRESHOLD_DEFAULT;
  await connectDB();

  const schedule = await FaultSchedule.findOne({ scheduleId: DEFAULT_SCHEDULE_ID }).lean();
  if (!schedule) {
    throw new Error(`Fault schedule "${DEFAULT_SCHEDULE_ID}" not found — cannot compute adaptation/recovery metrics`);
  }

  const results = {};
  for (const strategy of ROUTING_STRATEGIES) {
    const runIds = (await TransactionLog.distinct('runId', { strategy })).sort();
    results[strategy] = [];

    for (const runId of runIds) {
      // eslint-disable-next-line no-await-in-loop
      const logs = await TransactionLog.find({ runId }).select('transactionIndex finalOutcome attempts').lean();
      const metrics = computeRunMetrics(logs, schedule.events, { threshold });
      results[strategy].push({ runId, ...metrics });
      console.log(
        `${runId.padEnd(30)} success ${(100 * metrics.successRate).toFixed(2)}%  ` +
          `RT ${metrics.responseTimeMean.toFixed(1)}ms  p95 ${metrics.responseTimeP95}ms  ` +
          `failover ${metrics.failoverLatencyMean === null ? 'n/a' : metrics.failoverLatencyMean.toFixed(1) + 'ms'}  ` +
          `adapt ${metrics.adaptationLatencyMean === null ? 'n/a' : metrics.adaptationLatencyMean.toFixed(1)}  ` +
          `recover ${metrics.recoveryTimeMean === null ? 'n/a' : metrics.recoveryTimeMean.toFixed(1)}`
      );
    }
  }

  const outDir = path.join(__dirname, '../../analysis');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'run_metrics.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify({ degradationThreshold: threshold, scheduleId: DEFAULT_SCHEDULE_ID, results }, null, 2)
  );
  console.log(`\nWrote ${outPath}`);

  await disconnectDB();
}

main().catch((err) => {
  console.error('Metric export failed:', err);
  process.exit(1);
});
