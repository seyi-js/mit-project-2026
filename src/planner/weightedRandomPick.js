function weightedRandomPick(weights, random = Math.random) {
  const entries = Object.entries(weights);
  const r = random();
  let cumulative = 0;
  for (const [key, weight] of entries) {
    cumulative += weight;
    if (r < cumulative) return key;
  }
  return entries[entries.length - 1][0];
}

module.exports = { weightedRandomPick };
