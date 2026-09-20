// Pure state-transition logic for the Executor's circuit breaker — no
// MongoDB here (that's executor/circuitBreakerGuard.js). Same
// pure-logic/thin-integration split as analyser/healthScore.js + analyser.js.
//
// Simplification vs. a textbook circuit breaker: half_open allows ALL calls
// through, not exactly one probe. Simpler to implement correctly, and since
// it applies identically to every strategy it doesn't bias the strategy
// comparison — just not literally the textbook definition.
//
// Recovery is counted in BLOCKED ATTEMPTS, not wall-clock time — see
// CIRCUIT_BREAKER's comment in config/constants.js. A prior version used a
// millisecond timeout here and it was a real, data-invalidating bug: once
// open, blocked dispatches are near-instant, so thousands of transactions
// can complete faster than any fixed timer, permanently stranding the
// breaker open for the rest of a run.
function isCallAllowed(state) {
  return state.state !== 'open';
}

function recordSuccess() {
  return { state: 'closed', consecutiveFailures: 0, blockedAttempts: 0, openedAt: null, lastFailureAt: null };
}

// `now` and the threshold config are passed in (not read from
// Date.now()/constants internally) so this stays a pure, deterministic
// function — tests can assert on exact output without depending on real time.
function recordFailure(state, now, { failureThreshold }) {
  const consecutiveFailures = (state.consecutiveFailures || 0) + 1;
  // A half-open PROBE failing reopens immediately, regardless of the
  // consecutive-failure count — one bad probe is enough evidence the
  // provider still isn't healthy.
  const shouldOpen = state.state === 'half_open' || consecutiveFailures >= failureThreshold;

  if (shouldOpen) {
    return {
      state: 'open',
      consecutiveFailures,
      blockedAttempts: 0,
      openedAt: now,
      lastFailureAt: now,
    };
  }
  return { state: 'closed', consecutiveFailures, blockedAttempts: 0, openedAt: null, lastFailureAt: now };
}

// Called once per dispatch attempt that gets short-circuited while OPEN.
// Once blockedAttempts reaches resetAfterAttempts, flips to half_open (and
// resets the counter) so the very next canDispatch call lets a real probe
// through — regardless of how much or how little real time that took.
function recordBlockedAttempt(state, { resetAfterAttempts }) {
  const blockedAttempts = (state.blockedAttempts || 0) + 1;
  if (blockedAttempts >= resetAfterAttempts) {
    return { ...state, state: 'half_open', blockedAttempts: 0 };
  }
  return { ...state, blockedAttempts };
}

module.exports = { isCallAllowed, recordSuccess, recordFailure, recordBlockedAttempt };
