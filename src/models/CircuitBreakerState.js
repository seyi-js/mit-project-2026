const mongoose = require('mongoose');
const { PROVIDERS, CIRCUIT_BREAKER_STATES } = require('../config/constants');

// One document per provider — the Executor's circuit-breaker state
// (executor/circuitBreaker.js has the state-transition logic;
// executor/circuitBreakerGuard.js is what actually reads/writes this
// collection). This is deliberately identical machinery no matter which
// routing strategy is active — it's a controlled variable in the experiment,
// not something that varies by strategy.
//   closed     -> dispatching normally
//   open       -> short-circuiting dispatches; blockedAttempts counts how
//                 many have been short-circuited since it opened
//   half_open  -> blockedAttempts reached RESET_AFTER_BLOCKED_ATTEMPTS;
//                 allowing calls through again as a probe
// blockedAttempts is a COUNT, not a timestamp, deliberately — see
// CIRCUIT_BREAKER's comment in config/constants.js for why a wall-clock
// cooldown (the previous nextRetryAt design) was a real bug.
const CircuitBreakerStateSchema = new mongoose.Schema(
  {
    providerId: { type: String, enum: PROVIDERS, required: true, unique: true },
    state: {
      type: String,
      enum: CIRCUIT_BREAKER_STATES,
      default: 'closed',
    },
    consecutiveFailures: { type: Number, default: 0 },
    blockedAttempts: { type: Number, default: 0 },
    lastFailureAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CircuitBreakerState', CircuitBreakerStateSchema);
