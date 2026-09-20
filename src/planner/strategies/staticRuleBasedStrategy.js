const RoutingConfig = require('../../models/RoutingConfig');
const { PROVIDERS } = require('../../config/constants');
const { weightedRandomPick } = require('../weightedRandomPick');

// Baseline #2 (Section 5). Reads the fixed traffic-split weights from
// RoutingConfig — set once by experiment/routingConfig.js before a run and
// never touched again. Like single-provider, has no fallback: the brief only
// describes retry behaviour for cascading-failover/adaptive-health-scored,
// so a failed dispatch here just fails the transaction outright.
function createStaticRuleBasedStrategy({ random = Math.random } = {}) {
  return {
    name: 'static-rule-based',
    async selectProvider({ attemptNumber }) {
      if (attemptNumber > 1) return null; // no fallback

      const config = await RoutingConfig.findOne({ key: 'static-rule-based-weights' });
      if (!config) {
        throw new Error('RoutingConfig weights are not set for the static-rule-based strategy');
      }

      // Explicitly picks A/B/C off the Mongoose subdocument rather than
      // Object.entries(config.weights) directly, since a Mongoose nested
      // subdocument can carry its own extra fields (e.g. _id) that would
      // otherwise leak into the weighted pick as bogus extra "providers".
      const weights = PROVIDERS.reduce((acc, providerId) => {
        acc[providerId] = config.weights[providerId];
        return acc;
      }, {});
      return weightedRandomPick(weights, random);
    },
  };
}

module.exports = { createStaticRuleBasedStrategy };
