// Section 9 step 1: "reset all provider health scores in MongoDB to a
// neutral baseline" before each run — otherwise a bad run would bleed
// HealthScore/circuit-breaker state into the next one, corrupting the
// comparison. Deliberately does NOT touch TransactionLog — that's the
// experimental record and must accumulate across all 40 runs, not reset.
const ProviderHealth = require('../models/ProviderHealth');
const CircuitBreakerState = require('../models/CircuitBreakerState');
const { PROVIDERS, NEUTRAL_HEALTH_SCORE } = require('../config/constants');

async function resetRunState() {
  await Promise.all(
    PROVIDERS.map((providerId) =>
      ProviderHealth.findOneAndUpdate(
        { providerId },
        { $set: { healthScore: NEUTRAL_HEALTH_SCORE, recentObservations: [] } },
        { upsert: true, setDefaultsOnInsert: true }
      )
    )
  );

  await Promise.all(
    PROVIDERS.map((providerId) =>
      CircuitBreakerState.findOneAndUpdate(
        { providerId },
        {
          $set: {
            state: 'closed',
            consecutiveFailures: 0,
            blockedAttempts: 0,
            openedAt: null,
            lastFailureAt: null,
          },
        },
        { upsert: true, setDefaultsOnInsert: true }
      )
    )
  );
}

module.exports = { resetRunState };
