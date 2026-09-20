const mongoose = require('mongoose');
const { PROVIDERS, NEUTRAL_HEALTH_SCORE, BINARY_INDICATOR } = require('../config/constants');

// One raw signal from a single dispatch attempt, written by
// monitor/monitor.js's recordObservation(). Note observedValue is NOT set
// here — that's the Analyser's derived value (Section 4 Step 2), computed
// separately in analyser/healthScore.js and never written back onto old
// observation entries; it stays null unless something explicitly backfills it.
const ObservationSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true },
    latencyMs: { type: Number, required: true },
    errorIndicator: { type: Number, enum: BINARY_INDICATOR, required: true },
    timeoutIndicator: { type: Number, enum: BINARY_INDICATOR, required: true },
    observedValue: { type: Number, min: 0, max: 1, default: null },
  },
  { _id: false }
);

// One document per provider (A/B/C) — the "Knowledge" a MAPE-K loop shares.
// healthScore is written by analyser/analyser.js's updateHealthScore() and
// read by the Planner's adaptive strategy to rank providers.
// recentObservations is Monitor's rolling window (capped at
// ROLLING_WINDOW_SIZE via $push+$slice — see monitor/monitor.js), independent
// of the healthScore field's own EWMA math, which only needs the previous
// score, not this history.
const ProviderHealthSchema = new mongoose.Schema(
  {
    providerId: { type: String, enum: PROVIDERS, required: true, unique: true },
    healthScore: { type: Number, min: 0, max: 1, default: NEUTRAL_HEALTH_SCORE },
    recentObservations: { type: [ObservationSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProviderHealth', ProviderHealthSchema);
