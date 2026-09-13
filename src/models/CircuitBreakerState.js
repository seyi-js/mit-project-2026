const mongoose = require('mongoose');
const { PROVIDERS, CIRCUIT_BREAKER_STATES } = require('../config/constants');

const CircuitBreakerStateSchema = new mongoose.Schema(
  {
    providerId: { type: String, enum: PROVIDERS, required: true, unique: true },
    state: {
      type: String,
      enum: CIRCUIT_BREAKER_STATES,
      default: 'closed',
    },
    consecutiveFailures: { type: Number, default: 0 },
    lastFailureAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
    nextRetryAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CircuitBreakerState', CircuitBreakerStateSchema);
