function isCallAllowed(state) {
  return state.state !== 'open';
}

function recordSuccess() {
  return { state: 'closed', consecutiveFailures: 0, openedAt: null, nextRetryAt: null, lastFailureAt: null };
}

function recordFailure(state, now, { failureThreshold, resetTimeoutMs }) {
  const consecutiveFailures = (state.consecutiveFailures || 0) + 1;
  const shouldOpen = state.state === 'half_open' || consecutiveFailures >= failureThreshold;

  if (shouldOpen) {
    return {
      state: 'open',
      consecutiveFailures,
      openedAt: now,
      nextRetryAt: new Date(now.getTime() + resetTimeoutMs),
      lastFailureAt: now,
    };
  }
  return { state: 'closed', consecutiveFailures, openedAt: null, nextRetryAt: null, lastFailureAt: now };
}

module.exports = { isCallAllowed, recordSuccess, recordFailure };
