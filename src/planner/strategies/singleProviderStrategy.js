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
