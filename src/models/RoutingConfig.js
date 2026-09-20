const mongoose = require('mongoose');
const { PROVIDERS } = require('../config/constants');

// Used by exactly ONE strategy: static-rule-based (see
// planner/strategies/staticRuleBasedStrategy.js). Nothing else reads or
// writes this collection. `key` is a fixed singleton id — there's only ever
// meant to be one of these documents. It's created once by
// experiment/routingConfig.js's ensureRoutingConfigExists() before a
// static-rule-based run starts, and deliberately never updated afterward —
// "set once before a run and never updated at runtime" is a hard requirement
// from Section 5, not just a convention.
const RoutingConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'static-rule-based-weights', unique: true },
    weights: {
      A: { type: Number, required: true, min: 0, max: 1 },
      B: { type: Number, required: true, min: 0, max: 1 },
      C: { type: Number, required: true, min: 0, max: 1 },
    },
  },
  { timestamps: true }
);

// Guards against a typo'd config (e.g. weights that don't add up to a full
// 100% split) ever reaching the strategy at request time.
RoutingConfigSchema.pre('validate', function validateWeightsSumToOne(next) {
  const sum = PROVIDERS.reduce((total, p) => total + this.weights[p], 0);
  if (Math.abs(sum - 1) > 1e-6) {
    return next(new Error(`RoutingConfig weights must sum to 1, got ${sum}`));
  }
  next();
});

module.exports = mongoose.model('RoutingConfig', RoutingConfigSchema);
