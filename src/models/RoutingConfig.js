const mongoose = require('mongoose');
const { PROVIDERS } = require('../config/constants');

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

RoutingConfigSchema.pre('validate', function validateWeightsSumToOne(next) {
  const sum = PROVIDERS.reduce((total, p) => total + this.weights[p], 0);
  if (Math.abs(sum - 1) > 1e-6) {
    return next(new Error(`RoutingConfig weights must sum to 1, got ${sum}`));
  }
  next();
});

module.exports = mongoose.model('RoutingConfig', RoutingConfigSchema);
