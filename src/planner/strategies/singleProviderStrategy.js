// Baseline #1 (Section 5). Every strategy implements the same
// { name, selectProvider({attemptNumber, excludedProviders}) } shape — see
// planner/planner.js for the pluggable-interface entry point. selectProvider
// returning null tells the caller (api/transactionProcessor.js) "give up,
// mark the transaction failed" — here that happens on attempt 2, since the
// brief explicitly says this strategy has no fallback at all, regardless of
// how the first attempt went.
function createSingleProviderStrategy({ providerId = 'A' } = {}) {
  return {
    name: 'single-provider',
    async selectProvider({ attemptNumber }) {
      if (attemptNumber > 1) return null; // no fallback
      return providerId;
    },
  };
}

module.exports = { createSingleProviderStrategy };
