// The "Monitor" phase of MAPE-K (Section 2): captures a raw per-dispatch
// signal and persists it. Deliberately does NOT compute observedValue or
// touch healthScore — that's the Analyser's job (analyser/analyser.js),
// called separately right after this in api/transactionProcessor.js's retry
// loop. Keeping them as two calls (not one combined function) mirrors the
// brief's own MAPE-K phase separation.
const ProviderHealth = require('../models/ProviderHealth');
const { PROVIDERS, ATTEMPT_OUTCOMES, ROLLING_WINDOW_SIZE } = require('../config/constants');

// Maps the Executor's outcome string ('success'/'error'/'timeout') onto
// Section 4's e(t)/o(t) binary indicators. Exported so the Analyser can reuse
// this exact mapping instead of re-deriving it a second way.
function deriveIndicators(outcome) {
  return {
    errorIndicator: outcome === 'error' ? 1 : 0,
    timeoutIndicator: outcome === 'timeout' ? 1 : 0,
  };
}

async function recordObservation({ providerId, latencyMs, outcome, timestamp = new Date() }) {
  if (!PROVIDERS.includes(providerId)) {
    throw new Error(`Unknown providerId: ${providerId}`);
  }
  if (!ATTEMPT_OUTCOMES.includes(outcome)) {
    throw new Error(`Unknown outcome: ${outcome}`);
  }

  const { errorIndicator, timeoutIndicator } = deriveIndicators(outcome);
  const observation = { timestamp, latencyMs, errorIndicator, timeoutIndicator };

  // $push + $slice(-N) keeps only the most recent ROLLING_WINDOW_SIZE entries
  // — a fixed-size ring buffer done atomically in one write. upsert creates
  // the provider's document (at NEUTRAL_HEALTH_SCORE) the very first time
  // it's observed, so callers never have to pre-create ProviderHealth docs.
  await ProviderHealth.findOneAndUpdate(
    { providerId },
    {
      $push: {
        recentObservations: {
          $each: [observation],
          $slice: -ROLLING_WINDOW_SIZE,
        },
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return observation;
}

module.exports = { recordObservation, deriveIndicators };
