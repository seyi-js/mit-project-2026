// KAN-61: the two hyperparameter sensitivity analyses Section 4 asks for —
// the degradation threshold (Step 4) and the health-score weights (Step 2).
//
// Both are pure post-processing over the already-logged 400,000 transactions;
// neither requires re-running the experiment. What each CAN and CANNOT show:
//
//   Threshold: in this implementation the threshold never influenced routing
//   (the adaptive strategy deprioritises continuously by ranking rather than
//   via a threshold cliff — see planner/strategies/adaptiveHealthScoredStrategy.js).
//   So it affects only the two metrics defined in terms of it — adaptation
//   latency and recovery time — and success rate is identical at every value.
//
//   Weights: re-scoring the logged attempts shows how the MEASURED metrics
//   shift under different weightings. It cannot show how different weights
//   would have changed the routing decisions that actually occurred, since
//   those were made live using the default weights. Answering that would
//   require re-running the experiment per weighting.
require('dotenv').config();
const { connectDB, disconnectDB } = require('../config/db');
const TransactionLog = require('../models/TransactionLog');
const FaultSchedule = require('../models/FaultSchedule');
const { computeRunMetrics } = require('./metrics');
const { DEFAULT_SCHEDULE_ID } = require('../experiment/faultSchedule');
const { ROUTING_STRATEGIES, HEALTH_SCORE_WEIGHTS } = require('../config/constants');

const THRESHOLDS = [0.4, 0.5, 0.6];

const WEIGHT_SETS = [
  { label: 'brief default (.25/.50/.25)', weights: HEALTH_SCORE_WEIGHTS },
  { label: 'latency-heavy (.50/.25/.25)', weights: { w1_latency: 0.5, w2_error: 0.25, w3_timeout: 0.25 } },
  { label: 'error-heavy   (.15/.70/.15)', weights: { w1_latency: 0.15, w2_error: 0.7, w3_timeout: 0.15 } },
  { label: 'timeout-heavy (.25/.25/.50)', weights: { w1_latency: 0.25, w2_error: 0.25, w3_timeout: 0.5 } },
  { label: 'equal         (.34/.33/.33)', weights: { w1_latency: 0.34, w2_error: 0.33, w3_timeout: 0.33 } },
];

function mean(values) {
  const present = values.filter((v) => v !== null && v !== undefined);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length;
}

function fmt(value, digits = 2) {
  return value === null ? 'n/a' : value.toFixed(digits);
}

async function loadAllRuns() {
  const byStrategy = {};
  for (const strategy of ROUTING_STRATEGIES) {
    const runIds = (await TransactionLog.distinct('runId', { strategy })).sort();
    byStrategy[strategy] = [];
    for (const runId of runIds) {
      // eslint-disable-next-line no-await-in-loop
      const logs = await TransactionLog.find({ runId }).select('transactionIndex finalOutcome attempts').lean();
      byStrategy[strategy].push({ runId, logs });
    }
  }
  return byStrategy;
}

async function main() {
  await connectDB();
  const schedule = await FaultSchedule.findOne({ scheduleId: DEFAULT_SCHEDULE_ID }).lean();
  if (!schedule) throw new Error(`Fault schedule "${DEFAULT_SCHEDULE_ID}" not found`);

  console.log('Loading logged runs...');
  const runs = await loadAllRuns();

  // ---- Sensitivity 1: degradation threshold (Section 4 Step 4) ----
  console.log('\n' + '='.repeat(96));
  console.log('DEGRADATION THRESHOLD SENSITIVITY (Section 4 Step 4)');
  console.log('='.repeat(96));
  console.log(
    'Success rate is shown to confirm it is INVARIANT to the threshold — in this implementation\n' +
      'the threshold never influenced routing, so it cannot affect transaction success.\n'
  );
  console.log(
    `${'Strategy'.padEnd(24)} ${'Threshold'.padEnd(10)} ${'Success'.padEnd(10)} ` +
      `${'AdaptLatency'.padEnd(14)} ${'RecoveryTime'.padEnd(14)} ${'Events detected'}`
  );
  console.log('-'.repeat(96));

  for (const strategy of ROUTING_STRATEGIES) {
    for (const threshold of THRESHOLDS) {
      const perRun = runs[strategy].map((r) =>
        computeRunMetrics(r.logs, schedule.events, { threshold })
      );
      const success = mean(perRun.map((m) => m.successRate));
      const adapt = mean(perRun.map((m) => m.adaptationLatencyMean));
      const recover = mean(perRun.map((m) => m.recoveryTimeMean));
      const detected = mean(perRun.map((m) => m.adaptationLatencyCount));
      console.log(
        `${strategy.padEnd(24)} ${String(threshold).padEnd(10)} ${(100 * success).toFixed(2).padEnd(10)} ` +
          `${fmt(adapt).padEnd(14)} ${fmt(recover).padEnd(14)} ${fmt(detected, 1)} of ${schedule.events.length}`
      );
    }
    console.log('-'.repeat(96));
  }

  // ---- Sensitivity 2: health-score weights (Section 4 Step 2) ----
  console.log('\n' + '='.repeat(96));
  console.log('HEALTH-SCORE WEIGHT SENSITIVITY (Section 4 Step 2)');
  console.log('='.repeat(96));
  console.log(
    'Evaluated at threshold 0.6, the only value at which these metrics are measurable under the\n' +
      'brief default weights. Shows how the adaptive strategy\'s measured adaptation latency compares\n' +
      'with each baseline when the logged attempts are re-scored under a different weighting.\n'
  );
  console.log(
    `${'Weighting'.padEnd(30)} ${'adaptive'.padEnd(12)} ${'cascading'.padEnd(12)} ` +
      `${'single'.padEnd(12)} ${'static'.padEnd(12)} ${'adaptive best?'}`
  );
  console.log('-'.repeat(96));

  for (const { label, weights } of WEIGHT_SETS) {
    const byStrategy = {};
    for (const strategy of ROUTING_STRATEGIES) {
      const perRun = runs[strategy].map((r) =>
        computeRunMetrics(r.logs, schedule.events, { threshold: 0.6, weights })
      );
      byStrategy[strategy] = mean(perRun.map((m) => m.adaptationLatencyMean));
    }
    const adaptive = byStrategy['adaptive-health-scored'];
    const others = ROUTING_STRATEGIES.filter((s) => s !== 'adaptive-health-scored').map((s) => byStrategy[s]);
    const adaptiveBest =
      adaptive !== null && others.every((v) => v === null || adaptive <= v) ? 'yes' : 'no';

    console.log(
      `${label.padEnd(30)} ${fmt(adaptive).padEnd(12)} ${fmt(byStrategy['cascading-failover']).padEnd(12)} ` +
        `${fmt(byStrategy['single-provider']).padEnd(12)} ${fmt(byStrategy['static-rule-based']).padEnd(12)} ${adaptiveBest}`
    );
  }

  console.log('\nAdaptation latency is in transactions dispatched to the faulted provider (lower is better).');
  await disconnectDB();
}

main().catch((err) => {
  console.error('Sensitivity analysis failed:', err);
  process.exit(1);
});
