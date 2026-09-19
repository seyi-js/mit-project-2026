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
