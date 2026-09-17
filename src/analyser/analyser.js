const ProviderHealth = require('../models/ProviderHealth');
const { computeObservedValue, blendHealthScore, isDegraded } = require('./healthScore');
const {
  PROVIDERS,
  NEUTRAL_HEALTH_SCORE,
  HEALTH_SCORE_WEIGHTS,
  HEALTH_SCORE_SMOOTHING_ALPHA,
  DEGRADATION_THRESHOLD_DEFAULT,
} = require('../config/constants');

async function updateHealthScore({
  providerId,
  latencyMs,
  errorIndicator,
  timeoutIndicator,
  weights = HEALTH_SCORE_WEIGHTS,
  alpha = HEALTH_SCORE_SMOOTHING_ALPHA,
  threshold = DEGRADATION_THRESHOLD_DEFAULT,
}) {
  if (!PROVIDERS.includes(providerId)) {
    throw new Error(`Unknown providerId: ${providerId}`);
  }

  const providerHealth = await ProviderHealth.findOne({ providerId });
  const previousHealthScore = providerHealth ? providerHealth.healthScore : NEUTRAL_HEALTH_SCORE;

  const observedValue = computeObservedValue({ latencyMs, errorIndicator, timeoutIndicator }, weights);
  const healthScore = blendHealthScore(observedValue, previousHealthScore, alpha);

  await ProviderHealth.findOneAndUpdate(
    { providerId },
    { $set: { healthScore } },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return { providerId, observedValue, healthScore, degraded: isDegraded(healthScore, threshold) };
}

module.exports = { updateHealthScore };
