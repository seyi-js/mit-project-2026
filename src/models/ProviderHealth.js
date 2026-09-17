const mongoose = require('mongoose');
const { PROVIDERS, NEUTRAL_HEALTH_SCORE, BINARY_INDICATOR } = require('../config/constants');

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

const ProviderHealthSchema = new mongoose.Schema(
  {
    providerId: { type: String, enum: PROVIDERS, required: true, unique: true },
    healthScore: { type: Number, min: 0, max: 1, default: NEUTRAL_HEALTH_SCORE },
    recentObservations: { type: [ObservationSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProviderHealth', ProviderHealthSchema);
