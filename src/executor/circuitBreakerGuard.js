const CircuitBreakerState = require('../models/CircuitBreakerState');
const { isCallAllowed, recordSuccess, recordFailure, recordBlockedAttempt } = require('./circuitBreaker');
const { PROVIDERS, CIRCUIT_BREAKER } = require('../config/constants');

// .lean() returns a plain JS object rather than a Mongoose document —
// required here, not just an optimization: the pure functions in
// circuitBreaker.js spread this value (`{ ...state, ... }`), and spreading a
// real Mongoose document does NOT reliably copy its schema fields (a
// document's fields live behind getters, not as plain own-enumerable
// properties), silently producing an object with `state: undefined`.
async function getOrCreateState(providerId) {
  return CircuitBreakerState.findOneAndUpdate(
    { providerId },
    { $setOnInsert: { providerId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

// Called by executor/executor.js BEFORE every dispatch attempt. Only OPEN
// dispatches ever get counted/persisted here — closed and half_open are
// answered straight from the read, no write needed.
async function canDispatch(providerId, { resetAfterAttempts = CIRCUIT_BREAKER.RESET_AFTER_BLOCKED_ATTEMPTS } = {}) {
  if (!PROVIDERS.includes(providerId)) {
    throw new Error(`Unknown providerId: ${providerId}`);
  }

  const current = await getOrCreateState(providerId);
  if (current.state !== 'open') {
    return isCallAllowed(current);
  }

  // Every short-circuited attempt while open counts toward the cooldown.
  // Once it reaches resetAfterAttempts, this same call flips to half_open
  // and is itself allowed through as the probe.
  const next = recordBlockedAttempt(current, { resetAfterAttempts });
  await CircuitBreakerState.updateOne(
    { providerId },
    { $set: { state: next.state, blockedAttempts: next.blockedAttempts } }
  );
  return isCallAllowed(next);
}

// Called by executor/executor.js AFTER every real dispatch attempt (never
// called for a circuit-open short-circuit, since nothing was actually tried).
// 'error' and 'timeout' both count as failures here, same as they do for
// Section 4's HealthScore — a declined/failed authorisation is treated as
// provider misbehaviour for this experiment's simulated fault model, not a
// normal business outcome to ignore.
async function reportOutcome(
  providerId,
  outcome,
  { now = new Date(), failureThreshold = CIRCUIT_BREAKER.FAILURE_THRESHOLD } = {}
) {
  const current = await getOrCreateState(providerId);
  const next = outcome === 'success' ? recordSuccess() : recordFailure(current, now, { failureThreshold });

  await CircuitBreakerState.updateOne({ providerId }, { $set: next });
  return next;
}

module.exports = { canDispatch, reportOutcome };
