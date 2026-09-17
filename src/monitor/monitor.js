const ProviderHealth = require('../models/ProviderHealth');
const { PROVIDERS, ATTEMPT_OUTCOMES, ROLLING_WINDOW_SIZE } = require('../config/constants');

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
