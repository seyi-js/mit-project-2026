const ProviderHealth = require('../../models/ProviderHealth');
const { PROVIDERS, MAX_DISPATCH_ATTEMPTS, ADAPTIVE_STRATEGY, NEUTRAL_HEALTH_SCORE } = require('../../config/constants');

async function getRankedProviders() {
  const docs = await ProviderHealth.find({ providerId: { $in: PROVIDERS } });
  const scoreByProvider = new Map(PROVIDERS.map((providerId) => [providerId, NEUTRAL_HEALTH_SCORE]));
  for (const doc of docs) {
    scoreByProvider.set(doc.providerId, doc.healthScore);
  }
  return [...scoreByProvider.entries()].sort((a, b) => b[1] - a[1]).map(([providerId]) => providerId);
}

function createAdaptiveHealthScoredStrategy({
  maxAttempts = MAX_DISPATCH_ATTEMPTS,
  primaryAllocation = ADAPTIVE_STRATEGY.PRIMARY_ALLOCATION,
  random = Math.random,
} = {}) {
  return {
    name: 'adaptive-health-scored',
    async selectProvider({ attemptNumber, excludedProviders = [] }) {
      if (attemptNumber > maxAttempts) return null;

      const ranked = (await getRankedProviders()).filter((providerId) => !excludedProviders.includes(providerId));
      if (ranked.length === 0) return null;

      if (attemptNumber === 1 && ranked.length > 1) {
        if (random() < primaryAllocation) {
          return ranked[0];
        }
        const explorationPool = ranked.slice(1);
        return explorationPool[Math.floor(random() * explorationPool.length)];
      }

      // Retries (and the single-candidate edge case) always take the
      // next-highest-ranked remaining provider.
      return ranked[0];
    },
  };
}

module.exports = { createAdaptiveHealthScoredStrategy };
