const { PROVIDERS, MAX_DISPATCH_ATTEMPTS } = require('../../config/constants');

function createCascadingFailoverStrategy({ order = PROVIDERS, maxAttempts = MAX_DISPATCH_ATTEMPTS } = {}) {
  return {
    name: 'cascading-failover',
    async selectProvider({ attemptNumber, excludedProviders = [] }) {
      if (attemptNumber > maxAttempts) return null;
      const next = order.find((providerId) => !excludedProviders.includes(providerId));
      return next ?? null;
    },
  };
}

module.exports = { createCascadingFailoverStrategy };
