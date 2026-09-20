const { isCallAllowed, recordSuccess, recordFailure, recordBlockedAttempt } = require('../src/executor/circuitBreaker');

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
      blockedAttempts: 0,
      openedAt: null,
      lastFailureAt: null,
    });
  });
});

describe('recordFailure', () => {
  const config = { failureThreshold: 3 };
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
      blockedAttempts: 0,
      openedAt: now,
    });
  });

  test('a failed probe while half_open immediately reopens, regardless of threshold', () => {
    const next = recordFailure({ state: 'half_open', consecutiveFailures: 0 }, now, config);
    expect(next.state).toBe('open');
  });
});

describe('recordBlockedAttempt', () => {
  const config = { resetAfterAttempts: 3 };

  test('increments the blocked-attempt counter while under the reset threshold', () => {
    const next = recordBlockedAttempt({ state: 'open', blockedAttempts: 0 }, config);
    expect(next).toMatchObject({ state: 'open', blockedAttempts: 1 });
  });

  test('flips to half_open and resets the counter once the threshold is reached', () => {
    const next = recordBlockedAttempt({ state: 'open', blockedAttempts: 2 }, config);
    expect(next).toMatchObject({ state: 'half_open', blockedAttempts: 0 });
  });

  test('recovery is purely a function of call count, not elapsed time', () => {
    // Feed it 3 blocked attempts back-to-back with no time passing at all —
    // this is exactly the scenario that broke the old wall-clock design.
    let state = { state: 'open', blockedAttempts: 0 };
    state = recordBlockedAttempt(state, config);
    state = recordBlockedAttempt(state, config);
    state = recordBlockedAttempt(state, config);
    expect(state.state).toBe('half_open');
  });
});
