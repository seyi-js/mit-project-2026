// Pure math only — no MongoDB, no I/O of any kind. This is Section 4's
// health-scoring formulas exactly, split out from analyser/analyser.js (the
// thin MongoDB-integration layer that actually reads/writes ProviderHealth)
// specifically so it can be unit-tested in isolation with fixed inputs
// (KAN-28's tests/healthScore.test.js) — the build order calls this out as
// "pure math, easiest to get exactly right early."
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

// Section 4 Step 2: one transaction's score in [0,1] — 1 = fast, successful,
// no timeout; 0 = maximally bad on all three. weights is a parameter (not
// just read from constants internally) specifically so Chapter 4's weight
// sensitivity analysis can call this with different w1/w2/w3 combinations.
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

// Section 4 Step 3 — the exponential moving average that turns a single
// transaction's observedValue into the provider's ongoing HealthScore.
// analyser/analyser.js is what actually looks up previousHealthScore from
// MongoDB before calling this.
function blendHealthScore(observedValue, previousHealthScore, alpha = HEALTH_SCORE_SMOOTHING_ALPHA) {
  return alpha * observedValue + (1 - alpha) * previousHealthScore;
}

// Section 4 Step 4. Note this only answers "is it below threshold" — it's
// the Planner's adaptive strategy that decides what to DO about a degraded
// provider (deprioritise, not exclude); this function has no opinion on that.
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
