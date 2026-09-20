// The "Plan" phase of MAPE-K (Section 2) and the single entry point for
// getting a routing strategy — nothing outside this folder imports the
// individual strategy files directly. Used by api/transactionApi.js's
// PUT /strategy admin endpoint (live service) and experiment/experimentRunner.js
// (batch runs) alike.
const { ROUTING_STRATEGIES } = require('../config/constants');
const { createSingleProviderStrategy } = require('./strategies/singleProviderStrategy');
const { createStaticRuleBasedStrategy } = require('./strategies/staticRuleBasedStrategy');
const { createCascadingFailoverStrategy } = require('./strategies/cascadingFailoverStrategy');
const { createAdaptiveHealthScoredStrategy } = require('./strategies/adaptiveHealthScoredStrategy');

// Every strategy implements the same selectProvider({ attemptNumber, excludedProviders })
// async method — this shared shape is the pluggable RoutingStrategy interface.
const STRATEGY_FACTORIES = {
  'single-provider': createSingleProviderStrategy,
  'static-rule-based': createStaticRuleBasedStrategy,
  'cascading-failover': createCascadingFailoverStrategy,
  'adaptive-health-scored': createAdaptiveHealthScoredStrategy,
};

function createPlanner(strategyName, options = {}) {
  if (!ROUTING_STRATEGIES.includes(strategyName)) {
    throw new Error(`Unknown routing strategy: ${strategyName}`);
  }
  return STRATEGY_FACTORIES[strategyName](options);
}

module.exports = { createPlanner, STRATEGY_FACTORIES };
