// THE research contribution (Section 5's "proposed" strategy) — the
// independent variable this whole dissertation is testing. Everything else
// in the codebase (Monitor recording signals, Analyser updating HealthScore)
// exists to feed this one function's decisions; the other 3 strategies are
// just baselines to compare it against.
const ProviderHealth = require('../../models/ProviderHealth');
const { PROVIDERS, MAX_DISPATCH_ATTEMPTS, ADAPTIVE_STRATEGY, NEUTRAL_HEALTH_SCORE } = require('../../config/constants');

// Reads the LIVE HealthScore for all 3 providers and ranks them
// highest-first. A provider with no ProviderHealth document yet (never
// observed in this run) defaults to NEUTRAL_HEALTH_SCORE rather than being
// treated as 0 or excluded — it just starts in the middle of the pack. Called
// fresh on every selectProvider() call (including retries within the same
// transaction), so a failure on attempt 1 can genuinely change who gets
// picked on attempt 2 — that's the whole point of this being "adaptive."
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

      // Ranked list with already-tried providers removed — so "highest
      // remaining" naturally means "next-highest" on a retry, without any
      // separate retry-specific logic needed.
      const ranked = (await getRankedProviders()).filter((providerId) => !excludedProviders.includes(providerId));
      if (ranked.length === 0) return null;

      // The 90/10 split (Section 5) ONLY applies to a transaction's very
      // first attempt. `random() < primaryAllocation` is the 90% branch:
      // send it to whichever provider currently ranks #1. The other ~10% of
      // first attempts fall through to the exploration branch below.
      if (attemptNumber === 1 && ranked.length > 1) {
        if (random() < primaryAllocation) {
          return ranked[0];
        }
        // Exploration: picked uniformly from the OTHER providers (never the
        // current #1), so this 10% of traffic keeps refreshing their
        // HealthScores with real data — that's what lets a recovering
        // provider get detected and re-promoted later, and it's specifically
        // this exploration slice that's expected to make this strategy
        // recover from faults faster than the non-adaptive baselines.
        const explorationPool = ranked.slice(1);
        return explorationPool[Math.floor(random() * explorationPool.length)];
      }

      // Retries (attempt 2+), and the degenerate case where only one
      // candidate is left: always deterministic — no more coin flips, just
      // take the best of what's left.
      return ranked[0];
    },
  };
}

module.exports = { createAdaptiveHealthScoredStrategy };
