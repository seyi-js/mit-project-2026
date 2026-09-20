// Generic weighted choice: e.g. weights={A:0.5, B:0.3, C:0.2} picks 'A' 50%
// of the time by drawing r in [0,1) and walking the cumulative sum until r
// falls under it. Used by the static-rule-based strategy for its fixed
// traffic split. `random` is injectable (default Math.random) so tests can
// force a specific outcome deterministically instead of relying on real
// randomness.
function weightedRandomPick(weights, random = Math.random) {
  const entries = Object.entries(weights);
  const r = random();
  let cumulative = 0;
  for (const [key, weight] of entries) {
    cumulative += weight;
    if (r < cumulative) return key;
  }
  // Floating-point safety net: if the weights don't sum to EXACTLY 1 due to
  // rounding, r could exceed the final cumulative value — fall back to the
  // last entry rather than returning undefined.
  return entries[entries.length - 1][0];
}

module.exports = { weightedRandomPick };
