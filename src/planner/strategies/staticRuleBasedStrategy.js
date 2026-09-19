const RoutingConfig = require('../../models/RoutingConfig');
const { PROVIDERS } = require('../../config/constants');
const { weightedRandomPick } = require('../weightedRandomPick');

function createStaticRuleBasedStrategy({ random = Math.random } = {}) {
  return {
    name: 'static-rule-based',
    async selectProvider({ attemptNumber }) {
      if (attemptNumber > 1) return null; // no fallback

      const config = await RoutingConfig.findOne({ key: 'static-rule-based-weights' });
      if (!config) {
        throw new Error('RoutingConfig weights are not set for the static-rule-based strategy');
      }

      const weights = PROVIDERS.reduce((acc, providerId) => {
        acc[providerId] = config.weights[providerId];
        return acc;
      }, {});
      return weightedRandomPick(weights, random);
    },
  };
}

module.exports = { createStaticRuleBasedStrategy };
