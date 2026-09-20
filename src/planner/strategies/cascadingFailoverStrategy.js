const { PROVIDERS, MAX_DISPATCH_ATTEMPTS } = require('../../config/constants');

// Baseline #3 (Section 5) — one of the two strategies that actually retries.
// Order is FIXED (A -> B -> C by default) and never changes based on
// observed health; that's the whole point of this being a baseline for the
// adaptive strategy to beat. `excludedProviders` (providers already tried
// this transaction) is how the caller tells this which ones to skip on a retry.
function createCascadingFailoverStrategy({ order = PROVIDERS, maxAttempts = MAX_DISPATCH_ATTEMPTS } = {}) {
  return {
    name: 'cascading-failover',
    async selectProvider({ attemptNumber, excludedProviders = [] }) {
      if (attemptNumber > maxAttempts) return null;
      const next = order.find((providerId) => !excludedProviders.includes(providerId));
      return next ?? null; // also null once every provider in `order` has been tried
    },
  };
}

module.exports = { createCascadingFailoverStrategy };
