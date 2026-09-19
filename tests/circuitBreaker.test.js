const { isCallAllowed, recordSuccess, recordFailure } = require('../src/executor/circuitBreaker');

describe('isCallAllowed', () => {
  test('allows calls when closed', () => {
    expect(isCallAllowed({ state: 'closed' })).toBe(true);
  });

  test('allows calls when half_open', () => {
    expect(isCallAllowed({ state: 'half_open' })).toBe(true);
  });

  test('blocks calls when open', () => {
    expect(isCallAllowed({ state: 'open' })).toBe(false);
  });
});

describe('recordSuccess', () => {
  test('always resets to a clean closed state', () => {
    expect(recordSuccess()).toEqual({
      state: 'closed',
      consecutiveFailures: 0,
      openedAt: null,
      nextRetryAt: null,
      lastFailureAt: null,
    });
  });
});

describe('recordFailure', () => {
  const config = { failureThreshold: 3, resetTimeoutMs: 10000 };
  const now = new Date('2026-01-01T00:00:00.000Z');

  test('stays closed while under the failure threshold', () => {
    const next = recordFailure({ state: 'closed', consecutiveFailures: 1 }, now, config);
    expect(next).toMatchObject({ state: 'closed', consecutiveFailures: 2 });
  });

  test('opens once consecutive failures reach the threshold', () => {
    const next = recordFailure({ state: 'closed', consecutiveFailures: 2 }, now, config);
    expect(next).toMatchObject({
      state: 'open',
      consecutiveFailures: 3,
      openedAt: now,
      nextRetryAt: new Date(now.getTime() + config.resetTimeoutMs),
    });
  });

  test('a failed probe while half_open immediately reopens, regardless of threshold', () => {
    const next = recordFailure({ state: 'half_open', consecutiveFailures: 0 }, now, config);
    expect(next.state).toBe('open');
  });
});
