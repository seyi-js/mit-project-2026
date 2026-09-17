const { TIMING, HEALTH_SCORE_WEIGHTS, HEALTH_SCORE_SMOOTHING_ALPHA, DEGRADATION_THRESHOLD_DEFAULT } = require('../config/constants');

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function computeNormalizedLatency(
  { latencyMs, timeoutIndicator },
  { lMin = TIMING.L_MIN_MS, lMax = TIMING.L_MAX_MS } = {}
) {
  // A timed-out transaction is never scored as "slow" via latency — it's
  // captured entirely by the timeout indicator instead.
  const effectiveLatency = timeoutIndicator === 1 ? lMax : latencyMs;
  return clamp((effectiveLatency - lMin) / (lMax - lMin), 0, 1);
}

function computeObservedValue(
  { latencyMs, errorIndicator, timeoutIndicator },
  weights = HEALTH_SCORE_WEIGHTS
) {
  const latencyNorm = computeNormalizedLatency({ latencyMs, timeoutIndicator });
  return (
    weights.w1_latency * (1 - latencyNorm) +
    weights.w2_error * (1 - errorIndicator) +
    weights.w3_timeout * (1 - timeoutIndicator)
  );
}

function blendHealthScore(observedValue, previousHealthScore, alpha = HEALTH_SCORE_SMOOTHING_ALPHA) {
  return alpha * observedValue + (1 - alpha) * previousHealthScore;
}

function isDegraded(healthScore, threshold = DEGRADATION_THRESHOLD_DEFAULT) {
  return healthScore < threshold;
}

module.exports = {
  clamp,
  computeNormalizedLatency,
  computeObservedValue,
  blendHealthScore,
  isDegraded,
};
