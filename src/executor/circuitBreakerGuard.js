const CircuitBreakerState = require('../models/CircuitBreakerState');
const { isCallAllowed, recordSuccess, recordFailure } = require('./circuitBreaker');
const { PROVIDERS, CIRCUIT_BREAKER } = require('../config/constants');

async function getOrCreateState(providerId) {
  return CircuitBreakerState.findOneAndUpdate(
    { providerId },
    { $setOnInsert: { providerId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function canDispatch(providerId, { now = new Date() } = {}) {
  if (!PROVIDERS.includes(providerId)) {
    throw new Error(`Unknown providerId: ${providerId}`);
  }

  await CircuitBreakerState.findOneAndUpdate(
    { providerId, state: 'open', nextRetryAt: { $lte: now } },
    { $set: { state: 'half_open' } }
  );

  const current = await getOrCreateState(providerId);
  return isCallAllowed(current);
}

async function reportOutcome(
  providerId,
  outcome,
  {
    now = new Date(),
    failureThreshold = CIRCUIT_BREAKER.FAILURE_THRESHOLD,
    resetTimeoutMs = CIRCUIT_BREAKER.RESET_TIMEOUT_MS,
  } = {}
) {
  const current = await getOrCreateState(providerId);
  const next =
    outcome === 'success' ? recordSuccess() : recordFailure(current, now, { failureThreshold, resetTimeoutMs });

  await CircuitBreakerState.updateOne({ providerId }, { $set: next });
  return next;
}

module.exports = { canDispatch, reportOutcome };
