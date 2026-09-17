const {
  clamp,
  computeNormalizedLatency,
  computeObservedValue,
  blendHealthScore,
  isDegraded,
} = require('../src/analyser/healthScore');

describe('clamp', () => {
  test('passes values already inside the range through unchanged', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  test('clamps values below the minimum', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
  });

  test('clamps values above the maximum', () => {
    expect(clamp(2, 0, 1)).toBe(1);
  });
});

describe('computeNormalizedLatency', () => {
  test('is 0 at Lmin (fastest realistic response)', () => {
    expect(computeNormalizedLatency({ latencyMs: 100, timeoutIndicator: 0 })).toBe(0);
  });

  test('is 1 at Lmax', () => {
    expect(computeNormalizedLatency({ latencyMs: 3000, timeoutIndicator: 0 })).toBe(1);
  });

  test('is 0.5 at the midpoint between Lmin and Lmax', () => {
    expect(computeNormalizedLatency({ latencyMs: 1550, timeoutIndicator: 0 })).toBeCloseTo(0.5);
  });

  test('clamps latency faster than Lmin to 0', () => {
    expect(computeNormalizedLatency({ latencyMs: 50, timeoutIndicator: 0 })).toBe(0);
  });

  test('clamps latency slower than Lmax to 1', () => {
    expect(computeNormalizedLatency({ latencyMs: 5000, timeoutIndicator: 0 })).toBe(1);
  });

  test('critical rule: a timed-out transaction is always scored as Lmax latency, never double-counted', () => {
    // latencyMs here is deliberately something other than Lmax — the timeout
    // indicator must override it, per Section 4's no-double-count rule.
    expect(computeNormalizedLatency({ latencyMs: 500, timeoutIndicator: 1 })).toBe(1);
  });
});

describe('computeObservedValue', () => {
  test('is 1 for a fast, successful, non-timed-out transaction', () => {
    const value = computeObservedValue({ latencyMs: 100, errorIndicator: 0, timeoutIndicator: 0 });
    expect(value).toBeCloseTo(1);
  });

  test('is 0 for a maximally slow, failed, timed-out transaction', () => {
    const value = computeObservedValue({ latencyMs: 3000, errorIndicator: 1, timeoutIndicator: 1 });
    expect(value).toBeCloseTo(0);
  });

  test('respects custom weights (e.g. latency-only) instead of the hardcoded defaults', () => {
    const latencyOnly = { w1_latency: 1, w2_error: 0, w3_timeout: 0 };
    const value = computeObservedValue(
      { latencyMs: 3000, errorIndicator: 1, timeoutIndicator: 0 },
      latencyOnly
    );
    // errorIndicator=1 would normally drag this down, but with w2=0 it's ignored.
    expect(value).toBeCloseTo(0);

    const fastButDeclined = computeObservedValue(
      { latencyMs: 100, errorIndicator: 1, timeoutIndicator: 0 },
      latencyOnly
    );
    expect(fastButDeclined).toBeCloseTo(1);
  });

  test('sanity check: latency near Lacceptable (500ms) with no errors/timeouts scores close to 1', () => {
    const value = computeObservedValue({ latencyMs: 500, errorIndicator: 0, timeoutIndicator: 0 });
    expect(value).toBeGreaterThan(0.95);
  });
});

describe('blendHealthScore', () => {
  test('applies the exponential smoothing formula with the default alpha (0.3)', () => {
    expect(blendHealthScore(1, 0.5)).toBeCloseTo(0.3 * 1 + 0.7 * 0.5);
  });

  test('respects a custom alpha', () => {
    expect(blendHealthScore(1, 0.5, 0.9)).toBeCloseTo(0.9 * 1 + 0.1 * 0.5);
  });

  test('repeated blending converges toward a constant observed value regardless of starting point', () => {
    let healthScore = 0.1;
    for (let i = 0; i < 100; i += 1) {
      healthScore = blendHealthScore(0.9, healthScore);
    }
    expect(healthScore).toBeCloseTo(0.9, 3);
  });

  test('sanity check: a provider averaging ~500ms latency with no errors/timeouts converges to a HealthScore close to 1', () => {
    const observedValue = computeObservedValue({ latencyMs: 500, errorIndicator: 0, timeoutIndicator: 0 });
    let healthScore = 0.5; // neutral baseline
    for (let i = 0; i < 100; i += 1) {
      healthScore = blendHealthScore(observedValue, healthScore);
    }
    expect(healthScore).toBeGreaterThan(0.9);
  });
});

describe('isDegraded', () => {
  test('is degraded strictly below the default threshold (0.5)', () => {
    expect(isDegraded(0.49)).toBe(true);
    expect(isDegraded(0.5)).toBe(false);
    expect(isDegraded(0.51)).toBe(false);
  });

  test('supports the 0.4 sensitivity-analysis threshold', () => {
    expect(isDegraded(0.45, 0.4)).toBe(false);
    expect(isDegraded(0.35, 0.4)).toBe(true);
  });

  test('supports the 0.6 sensitivity-analysis threshold', () => {
    expect(isDegraded(0.55, 0.6)).toBe(true);
    expect(isDegraded(0.65, 0.6)).toBe(false);
  });
});
