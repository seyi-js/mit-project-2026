const { weightedRandomPick } = require('../src/planner/weightedRandomPick');

describe('weightedRandomPick', () => {
  const weights = { A: 0.5, B: 0.3, C: 0.2 };

  test('picks A for a random draw in [0, 0.5)', () => {
    expect(weightedRandomPick(weights, () => 0.1)).toBe('A');
    expect(weightedRandomPick(weights, () => 0.49)).toBe('A');
  });

  test('picks B for a random draw in [0.5, 0.8)', () => {
    expect(weightedRandomPick(weights, () => 0.5)).toBe('B');
    expect(weightedRandomPick(weights, () => 0.79)).toBe('B');
  });

  test('picks C for a random draw in [0.8, 1)', () => {
    expect(weightedRandomPick(weights, () => 0.8)).toBe('C');
    expect(weightedRandomPick(weights, () => 0.99)).toBe('C');
  });

  test('over a large sample, observed proportions roughly match the configured weights', () => {
    const counts = { A: 0, B: 0, C: 0 };
    const samples = 20000;
    for (let i = 0; i < samples; i += 1) {
      counts[weightedRandomPick(weights)] += 1;
    }
    expect(counts.A / samples).toBeCloseTo(0.5, 1);
    expect(counts.B / samples).toBeCloseTo(0.3, 1);
    expect(counts.C / samples).toBeCloseTo(0.2, 1);
  });
});
