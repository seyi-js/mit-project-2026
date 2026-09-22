// Splits first-attempt routing accuracy by CONDITION — inside a fault window
// versus outside one — and measures misrouting directly.
//
// Why this exists: only ~26% of transactions occur while any provider is
// degraded. The other ~74% run against three healthy providers, where every
// routing strategy performs identically because the choice does not matter.
// A whole-run average therefore dilutes the effect roughly fourfold and
// understates what the adaptive mechanism actually does.
//
// "Misrouted" means the Planner's FIRST attempt went to a provider that was
// under an active fault at that transaction index. It is the most direct
// measure of routing quality available: unlike success rate it is not
// rescued by retries, and unlike response time it is not affected by how
// fast a failure happens to fail.
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

  const faultedAt = (idx) =>
    schedule.events
      .filter((e) => idx >= e.startTransactionIndex && idx < e.endTransactionIndex)
      .map((e) => e.providerId);

  const results = {};
  for (const strategy of ROUTING_STRATEGIES) {
    const runIds = (await TransactionLog.distinct('runId', { strategy })).sort();
    const outside = [];
    const inside = [];
    const misrouted = [];

    for (const runId of runIds) {
      // eslint-disable-next-line no-await-in-loop
      const logs = await TransactionLog.find({ runId }).select('transactionIndex attempts').lean();
      let oHit = 0, oTot = 0, iHit = 0, iTot = 0, mis = 0, misTot = 0;

      for (const log of logs) {
        const first = log.attempts[0];
        if (!first) continue;
        const faulted = faultedAt(log.transactionIndex);

        if (faulted.length > 0) {
          iTot += 1;
          if (first.outcome === 'success') iHit += 1;
          misTot += 1;
          if (faulted.includes(first.providerId)) mis += 1;
        } else {
          oTot += 1;
          if (first.outcome === 'success') oHit += 1;
        }
      }
      outside.push(oHit / oTot);
      inside.push(iHit / iTot);
      misrouted.push(mis / misTot);
    }
    results[strategy] = { outside, inside, misrouted };
  }

  const windowTx = Array.from({ length: 10000 }, (_, i) => faultedAt(i).length > 0).filter(Boolean).length;
  console.log(`Transactions inside a fault window: ${windowTx} of 10000 (${(windowTx / 100).toFixed(1)}%)`);
  console.log('Routing only matters inside these; outside them all strategies are equivalent.\n');
  console.log('Strategy'.padEnd(26) + 'outside'.padEnd(12) + 'INSIDE'.padEnd(22) + 'misrouted 1st attempts');
  console.log('-'.repeat(88));
  for (const strategy of ROUTING_STRATEGIES) {
    const r = results[strategy];
    console.log(
      strategy.padEnd(26) +
        pct(mean(r.outside)).padEnd(12) +
        `${pct(mean(r.inside))} (sd ${(100 * sd(r.inside)).toFixed(2)})`.padEnd(22) +
        `${pct(mean(r.misrouted))} (sd ${(100 * sd(r.misrouted)).toFixed(2)})`
    );
  }

  const outPath = path.join(__dirname, '../../analysis/condition_split.json');
  fs.writeFileSync(outPath, JSON.stringify({ scheduleId: DEFAULT_SCHEDULE_ID, windowTransactions: windowTx, results }, null, 2));
  console.log(`\nWrote ${outPath}`);
  await disconnectDB();
}

main().catch((err) => {
  console.error('Condition-split analysis failed:', err);
  process.exit(1);
});
