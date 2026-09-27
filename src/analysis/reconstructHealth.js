// Exports each run's provider HealthScore trajectory to CSV, for the
// "provider health over time" figures.
//
// WHY THIS EXISTS: ProviderHealth stores only a provider's CURRENT score and
// a 200-entry rolling window, and it is reset at the start of every run — so
// no history of health over time survives the experiment. That history is
// however fully recoverable, because the Analyser is a deterministic function
// of the ordered sequence of observations, and every observation is preserved
// in TransactionLog.
//
// This script does NOT re-implement the scoring. It calls
// analysis/metrics.js's reconstructHealthTimeline — the same function the
// adaptation-latency and recovery-time metrics are already computed from,
// which in turn calls analyser/healthScore.js's formulas and
// monitor/monitor.js's indicator mapping. The figures therefore plot exactly
// the trajectory the reported metrics were derived from.
//
// VALIDATION: ProviderHealth was never reset after the final run, so its
// three documents still hold the true final scores of the last run executed.
// main() reconstructs that run and compares. The reconstruction reproduces
// all three to exact floating-point equality.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const TransactionLog = require('../models/TransactionLog');
const ProviderHealth = require('../models/ProviderHealth');
const { reconstructHealthTimeline } = require('./metrics');

const ANALYSIS_DIR = path.join(__dirname, '..', '..', 'analysis');
const OUT_DIR = path.join(ANALYSIS_DIR, 'health_timeseries');

async function reconstructRun(runId) {
  const logs = await TransactionLog.find({ runId })
    .sort({ transactionIndex: 1 })
    .select('transactionIndex attempts')
    .lean();

  const timeline = reconstructHealthTimeline(logs);

  const rows = [];
  const finalScores = {};
  let observations = 0;

  for (const [providerId, points] of Object.entries(timeline)) {
    observations += points.length;
    if (points.length > 0) finalScores[providerId] = points[points.length - 1].healthScore;
    for (const point of points) {
      rows.push(`${point.transactionIndex},${providerId},${point.healthScore.toFixed(8)}`);
    }
  }

  // Sort by transaction index so the CSV reads in execution order.
  rows.sort((a, b) => Number(a.split(',')[0]) - Number(b.split(',')[0]));

  return { runId, rows, finalScores, observations, transactions: logs.length };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const runIds = (await TransactionLog.distinct('runId')).sort();
  const summary = [];

  for (const runId of runIds) {
    const result = await reconstructRun(runId);
    fs.writeFileSync(
      path.join(OUT_DIR, `${runId}.csv`),
      `transactionIndex,provider,healthScore\n${result.rows.join('\n')}\n`
    );
    summary.push({
      runId: result.runId,
      transactions: result.transactions,
      observations: result.observations,
      finalScores: result.finalScores,
    });
    process.stdout.write(`  ${runId.padEnd(30)} tx=${result.transactions} observations=${result.observations}\n`);
  }

  // --- validation against surviving live state -------------------------------
  const lastRun = (await TransactionLog.find({}).sort({ createdAt: -1 }).limit(1).lean())[0].runId;
  const live = await ProviderHealth.find({}).lean();
  const reconstructed = summary.find((s) => s.runId === lastRun).finalScores;

  const validation = { lastRun, comparisons: [], maxAbsoluteError: 0 };
  for (const doc of live) {
    const delta = Math.abs(doc.healthScore - reconstructed[doc.providerId]);
    validation.maxAbsoluteError = Math.max(validation.maxAbsoluteError, delta);
    validation.comparisons.push({
      provider: doc.providerId,
      live: doc.healthScore,
      reconstructed: reconstructed[doc.providerId],
      absoluteError: delta,
    });
  }
  validation.exact = validation.maxAbsoluteError === 0;

  fs.writeFileSync(
    path.join(ANALYSIS_DIR, 'health_reconstruction.json'),
    JSON.stringify({ validation, runs: summary }, null, 2)
  );

  console.log(`\n=== VALIDATION against live ProviderHealth (${lastRun}) ===`);
  for (const c of validation.comparisons) {
    console.log(`  Provider ${c.provider}: live=${c.live}  reconstructed=${c.reconstructed}  |error|=${c.absoluteError}`);
  }
  console.log(`  max absolute error: ${validation.maxAbsoluteError}  ->  ${validation.exact ? 'EXACT MATCH' : 'MISMATCH'}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
