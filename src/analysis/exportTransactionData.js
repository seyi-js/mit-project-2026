// Exports one row per logged transaction, for the distribution figures
// (response-time boxplots in particular, which need the underlying values
// rather than the per-run means already in run_metrics_*.csv).
//
// Response time uses the SAME definition as analysis/metrics.js: the elapsed
// time from the first attempt's dispatch to the last attempt's response,
// i.e. API submission through to final outcome, inclusive of any retries.
//
// insideWindow marks whether the transaction's index falls within any fault
// window of the schedule. Windows are half-open [start, end), matching the
// fault applier. It is what allows the condition split — routing choice is
// only consequential while some provider is faulted.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const TransactionLog = require('../models/TransactionLog');
const FaultSchedule = require('../models/FaultSchedule');

const OUT = path.join(__dirname, '..', '..', 'analysis', 'transaction_data.csv');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const schedule = await FaultSchedule.findOne({}).lean();
  const windows = schedule.events.map((e) => [e.startTransactionIndex, e.endTransactionIndex]);
  const insideWindow = (index) => windows.some(([s, e]) => index >= s && index < e);

  const out = fs.createWriteStream(OUT);
  out.write('strategy,runId,transactionIndex,responseTimeMs,finalOutcome,firstAttemptOutcome,firstAttemptProvider,attemptCount,insideWindow\n');

  const runIds = (await TransactionLog.distinct('runId')).sort();
  let total = 0;

  for (const runId of runIds) {
    const logs = await TransactionLog.find({ runId })
      .sort({ transactionIndex: 1 })
      .select('strategy transactionIndex attempts finalOutcome')
      .lean();

    for (const log of logs) {
      if (log.attempts.length === 0) continue;
      const first = log.attempts[0];
      const last = log.attempts[log.attempts.length - 1];
      const responseTimeMs = new Date(last.respondedAt) - new Date(first.dispatchedAt);
      out.write([
        log.strategy,
        runId,
        log.transactionIndex,
        responseTimeMs,
        log.finalOutcome,
        first.outcome,
        first.providerId,
        log.attempts.length,
        insideWindow(log.transactionIndex) ? 1 : 0,
      ].join(',') + '\n');
      total += 1;
    }
    process.stdout.write(`  ${runId.padEnd(30)} ${logs.length}\n`);
  }

  await new Promise((resolve) => out.end(resolve));
  console.log(`\nWrote ${total} rows to ${OUT}`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
