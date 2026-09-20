const ProviderHealth = require('../models/ProviderHealth');
const { computeObservedValue, blendHealthScore, isDegraded } = require('./healthScore');
const {
  PROVIDERS,
  NEUTRAL_HEALTH_SCORE,
  HEALTH_SCORE_WEIGHTS,
  HEALTH_SCORE_SMOOTHING_ALPHA,
  DEGRADATION_THRESHOLD_DEFAULT,
} = require('../config/constants');

// The "Analyse" phase of MAPE-K (Section 2) — the thin MongoDB layer around
// healthScore.js's pure formulas. Called once per dispatch attempt, right
// after monitor/monitor.js's recordObservation() for that same attempt (see
// api/transactionProcessor.js), so HealthScore is always "recalculated after
// every transaction dispatched to it" as Section 4 requires — including
// mid-transaction, between retry attempts, which is what lets the adaptive
// strategy react to a failure before choosing its next provider.
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

  // No ProviderHealth doc yet (provider never observed before) -> blend
  // against the neutral baseline rather than treating it as 0.
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
