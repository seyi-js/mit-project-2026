const {
  computeRunMetrics,
  reconstructHealthTimeline,
  adaptationLatency,
  recoveryTime,
  percentile,
  isCircuitOpenAttempt,
} = require('../src/analysis/metrics');

// Builds a transaction log entry with explicit timings so response-time and
// failover-latency arithmetic can be asserted exactly.
function tx(transactionIndex, attempts, finalOutcome) {
  return {
    transactionIndex,
    finalOutcome,
    attempts: attempts.map((a, i) => ({
      attemptNumber: i + 1,
      providerId: a.providerId,
      dispatchedAt: new Date(a.dispatchedAt),
      respondedAt: new Date(a.respondedAt),
      latencyMs: a.latencyMs,
      outcome: a.outcome,
    })),
  };
}

describe('isCircuitOpenAttempt', () => {
  test('identifies a short-circuited attempt (error at exactly 0ms)', () => {
    expect(isCircuitOpenAttempt({ outcome: 'error', latencyMs: 0 })).toBe(true);
  });

  test('does not treat a real declined authorization as short-circuited', () => {
    expect(isCircuitOpenAttempt({ outcome: 'error', latencyMs: 4 })).toBe(false);
  });

  test('does not treat a sub-millisecond success as short-circuited', () => {
    expect(isCircuitOpenAttempt({ outcome: 'success', latencyMs: 0 })).toBe(false);
  });
});

describe('percentile', () => {
  test('returns the nearest-rank value', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
  });

  test('returns null for an empty set', () => {
    expect(percentile([], 0.95)).toBeNull();
  });
});

describe('reconstructHealthTimeline', () => {
  test('skips circuit-open attempts, matching what the live system did', () => {
    const logs = [
      tx(0, [{ providerId: 'A', dispatchedAt: 0, respondedAt: 0, latencyMs: 0, outcome: 'error' }], 'failed'),
    ];
    expect(reconstructHealthTimeline(logs).A).toHaveLength(0);
  });

  test('applies the real EWMA: a fast success moves 0.5 toward 1.0 by alpha', () => {
    const logs = [
      tx(0, [{ providerId: 'A', dispatchedAt: 0, respondedAt: 5, latencyMs: 5, outcome: 'success' }], 'success'),
    ];
    // observedValue = 1.0, so 0.3*1.0 + 0.7*0.5 = 0.65
    expect(reconstructHealthTimeline(logs).A[0].healthScore).toBeCloseTo(0.65);
  });

  test('a timeout scores exactly 0.5, so the score converges to but never crosses 0.5', () => {
    const logs = Array.from({ length: 50 }, (_, i) =>
      tx(i, [{ providerId: 'A', dispatchedAt: 0, respondedAt: 3000, latencyMs: 3000, outcome: 'timeout' }], 'failed')
    );
    const scores = reconstructHealthTimeline(logs).A.map((e) => e.healthScore);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0.5);
  });
});

describe('adaptationLatency', () => {
  const timeline = {
    A: [
      { transactionIndex: 10, healthScore: 0.9 },
      { transactionIndex: 11, healthScore: 0.7 },
      { transactionIndex: 12, healthScore: 0.55 }, // crosses below 0.6 on the 3rd dispatch
      { transactionIndex: 40, healthScore: 0.2 }, // AFTER the fault window
    ],
  };

  test('counts dispatches to that provider until the score crosses below the threshold', () => {
    expect(adaptationLatency(timeline, 'A', 10, 20, 0.6)).toBe(3);
  });

  test('is censored (null) when the score never crosses during the fault window', () => {
    // Bounded to [10,12): only scores 0.9 and 0.7, neither below 0.6.
    expect(adaptationLatency(timeline, 'A', 10, 12, 0.6)).toBeNull();
  });

  test('does NOT count crossings that happen after the fault window ended', () => {
    // index 40 is below threshold but falls outside [10,20) — counting it
    // would measure an unrelated later period, which is the bug this guards.
    expect(adaptationLatency(timeline, 'A', 10, 20, 0.3)).toBeNull();
  });
});

describe('recoveryTime', () => {
  const timeline = {
    A: [
      { transactionIndex: 10, healthScore: 0.4 }, // degraded at fault end
      { transactionIndex: 21, healthScore: 0.5 },
      { transactionIndex: 22, healthScore: 0.7 }, // recovered on the 2nd dispatch
    ],
  };

  test('counts dispatches after the fault until the score returns above threshold', () => {
    expect(recoveryTime(timeline, 'A', 20, 100, 0.6)).toBe(2);
  });

  test('returns null when the provider was never degraded at the fault end', () => {
    const healthy = { A: [{ transactionIndex: 10, healthScore: 0.95 }, { transactionIndex: 21, healthScore: 0.95 }] };
    expect(recoveryTime(healthy, 'A', 20, 100, 0.6)).toBeNull();
  });

  test('does not look past the provider\'s next fault', () => {
    expect(recoveryTime(timeline, 'A', 20, 22, 0.6)).toBeNull();
  });
});

describe('computeRunMetrics', () => {
  const logs = [
    // fast success on first attempt
    tx(0, [{ providerId: 'A', dispatchedAt: 0, respondedAt: 10, latencyMs: 10, outcome: 'success' }], 'success'),
    // first attempt fails, second succeeds -> retried transaction
    tx(1, [
      { providerId: 'A', dispatchedAt: 100, respondedAt: 200, latencyMs: 100, outcome: 'timeout' },
      { providerId: 'B', dispatchedAt: 200, respondedAt: 210, latencyMs: 10, outcome: 'success' },
    ], 'success'),
    // fails fast (circuit open) -> a FAST failure
    tx(2, [{ providerId: 'A', dispatchedAt: 300, respondedAt: 300, latencyMs: 0, outcome: 'error' }], 'failed'),
  ];

  test('first-attempt success rate counts only the Planner\'s initial choice', () => {
    // tx 0 succeeded first try; tx 1 did not; tx 2 did not => 1/3
    expect(computeRunMetrics(logs, []).firstAttemptSuccessRate).toBeCloseTo(1 / 3);
  });

  test('overall success rate counts transactions rescued by a retry', () => {
    // tx 0 and tx 1 both ended successfully => 2/3, higher than first-attempt
    expect(computeRunMetrics(logs, []).successRate).toBeCloseTo(2 / 3);
  });

  test('success-only response time excludes fast failures that flatter the mean', () => {
    const m = computeRunMetrics(logs, []);
    // all: (10 + 110 + 0)/3 = 40 ; successes only: (10 + 110)/2 = 60
    expect(m.responseTimeMean).toBeCloseTo(40);
    expect(m.responseTimeMeanSuccessOnly).toBeCloseTo(60);
    expect(m.responseTimeMeanSuccessOnly).toBeGreaterThan(m.responseTimeMean);
  });

  test('failover latency measures only the extra time after the first attempt resolved', () => {
    const m = computeRunMetrics(logs, []);
    expect(m.failoverLatencyMean).toBeCloseTo(10); // 210 - 200
    expect(m.retriedTransactions).toBe(1);
  });

  test('exposes per-event adaptation/recovery so comparisons can be restricted to common events', () => {
    const events = [
      { providerId: 'A', faultType: 'full_outage', startTransactionIndex: 0, endTransactionIndex: 3, params: {} },
    ];
    const m = computeRunMetrics(logs, events);
    expect(m.adaptationByEvent).toHaveLength(1);
    expect(m.recoveryByEvent).toHaveLength(1);
  });
});
