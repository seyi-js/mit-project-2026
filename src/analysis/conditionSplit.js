// Splits first-attempt routing accuracy by CONDITION — inside a fault window
// versus outside one — and measures misrouting directly.
//
// Why this exists: only ~26% of transactions occur while any provider is
// degraded. The other ~74% run against three healthy providers, where every
// routing strategy performs identically because the choice does not matter.
// A whole-run average therefore dilutes the effect roughly fourfold and
// understates what the adaptive mechanism actually does.
//
// "Misrouted" means the Planner's FIRST attempt went to a provider under an
// active OUTCOME-AFFECTING fault at that transaction index. It is the most
// direct measure of routing quality available: unlike success rate it is not
// rescued by retries, and unlike response time it is not affected by how
// fast a failure happens to fail.
//
// degraded_latency is deliberately EXCLUDED from the headline misrouting
// figure, for three reasons:
//   1. Consistency — a latency-degraded provider still returns success, and
//      the first-attempt-success metric counts it as one. Treating it as a
//      routing error in one metric and a success in the other is incoherent.
//   2. Both degraded_latency windows land on providers B and C, and
//      single-provider/cascading-failover never send a first attempt to
//      anything but A. They therefore score a perfect 0% on latency faults
//      by coincidence of schedule placement, not by routing skill — that
//      comparison measures the fault schedule, not the strategies.
//   3. It is the outcome-affecting faults that bear on reliability.
// Both figures are reported below so the distinction is visible rather than
// buried in a definition.
const OUTCOME_AFFECTING_FAULTS = ['elevated_error_rate', 'intermittent_timeout', 'full_outage'];
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDB, disconnectDB } = require('../config/db');
const TransactionLog = require('../models/TransactionLog');
const FaultSchedule = require('../models/FaultSchedule');
const { DEFAULT_SCHEDULE_ID } = require('../experiment/faultSchedule');
const { ROUTING_STRATEGIES } = require('../config/constants');

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};
const pct = (v) => (100 * v).toFixed(2) + '%';

async function main() {
  await connectDB();
  const schedule = await FaultSchedule.findOne({ scheduleId: DEFAULT_SCHEDULE_ID }).lean();
  if (!schedule) throw new Error(`Fault schedule "${DEFAULT_SCHEDULE_ID}" not found`);

  const activeAt = (idx) =>
    schedule.events.filter((e) => idx >= e.startTransactionIndex && idx < e.endTransactionIndex);

  const results = {};
  for (const strategy of ROUTING_STRATEGIES) {
    const runIds = (await TransactionLog.distinct('runId', { strategy })).sort();
    const outside = [];
    const inside = [];
    const misroutedOutcome = [];
    const misroutedLatency = [];

    for (const runId of runIds) {
      // eslint-disable-next-line no-await-in-loop
      const logs = await TransactionLog.find({ runId }).select('transactionIndex attempts').lean();
      let oHit = 0, oTot = 0, iHit = 0, iTot = 0;
      let misOa = 0, denOa = 0, misLat = 0, denLat = 0;

      for (const log of logs) {
        const first = log.attempts[0];
        if (!first) continue;
        const events = activeAt(log.transactionIndex);

        if (events.length === 0) {
          oTot += 1;
          if (first.outcome === 'success') oHit += 1;
          continue;
        }

        iTot += 1;
        if (first.outcome === 'success') iHit += 1;

        const outcomeAffecting = events.filter((e) => OUTCOME_AFFECTING_FAULTS.includes(e.faultType));
        if (outcomeAffecting.length > 0) {
          denOa += 1;
          if (outcomeAffecting.some((e) => e.providerId === first.providerId)) misOa += 1;
        }

        const latencyOnly = events.filter((e) => e.faultType === 'degraded_latency');
        if (latencyOnly.length > 0) {
          denLat += 1;
          if (latencyOnly.some((e) => e.providerId === first.providerId)) misLat += 1;
        }
      }
      outside.push(oHit / oTot);
      inside.push(iHit / iTot);
      misroutedOutcome.push(misOa / denOa);
      misroutedLatency.push(misLat / denLat);
    }
    results[strategy] = { outside, inside, misroutedOutcome, misroutedLatency };
  }

  const windowTx = Array.from({ length: 10000 }, (_, i) => activeAt(i).length > 0).filter(Boolean).length;
  console.log(`Transactions inside a fault window: ${windowTx} of 10000 (${(windowTx / 100).toFixed(1)}%)`);
  console.log('Routing only matters inside these; outside them all strategies are equivalent.\n');
  console.log(
    'Strategy'.padEnd(26) +
      '1st-attempt success'.padEnd(34) +
      'misrouted 1st attempts'
  );
  console.log(
    ''.padEnd(26) + 'outside     INSIDE'.padEnd(34) + 'outcome-affecting   latency-only'
  );
  console.log('-'.repeat(96));
  for (const strategy of ROUTING_STRATEGIES) {
    const r = results[strategy];
    console.log(
      strategy.padEnd(26) +
        pct(mean(r.outside)).padEnd(12) +
        `${pct(mean(r.inside))} (sd ${(100 * sd(r.inside)).toFixed(2)})`.padEnd(22) +
        `${pct(mean(r.misroutedOutcome))} (sd ${(100 * sd(r.misroutedOutcome)).toFixed(2)})`.padEnd(20) +
        pct(mean(r.misroutedLatency))
    );
  }
  console.log(
    '\nHEADLINE misrouting = outcome-affecting column. The latency-only column is NOT\n' +
      'comparable across strategies: both degraded_latency windows fall on providers B and C,\n' +
      'and single-provider/cascading-failover never send a first attempt anywhere but A, so\n' +
      'their 0% reflects where the faults were placed rather than any routing decision.'
  );

  const outPath = path.join(__dirname, '../../analysis/condition_split.json');
  fs.writeFileSync(outPath, JSON.stringify({ scheduleId: DEFAULT_SCHEDULE_ID, windowTransactions: windowTx, results }, null, 2));
  console.log(`\nWrote ${outPath}`);
  await disconnectDB();
}

main().catch((err) => {
  console.error('Condition-split analysis failed:', err);
  process.exit(1);
});
