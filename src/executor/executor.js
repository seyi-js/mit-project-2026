// The "Execute" phase of MAPE-K (Section 2): one dispatch attempt to ONE
// provider, wrapped in the two safety mechanisms that must stay identical
// across all 4 routing strategies — circuit breaker and idempotency. This
// module has NO idea which routing strategy is active; it just executes
// whatever provider it's told to try. api/transactionProcessor.js is what
// calls this once per attempt inside a strategy's retry loop.
const { dispatchToProvider } = require('./providerClient');
const { canDispatch, reportOutcome } = require('./circuitBreakerGuard');
const { IdempotencyGuard } = require('./idempotency');

const defaultIdempotencyGuard = new IdempotencyGuard();

async function executeDispatch({
  providerId,
  idempotencyKey = null,
  baseUrl,
  timeoutMs,
  idempotencyGuard = defaultIdempotencyGuard,
} = {}) {
  const run = async () => {
    const allowed = await canDispatch(providerId);
    if (!allowed) {
      // Short-circuited: the provider is never actually contacted, so
      // there's no real latency/outcome to report — circuitOpen:true is how
      // the caller knows this wasn't a genuine observation of the provider.
      return { providerId, latencyMs: 0, outcome: 'error', circuitOpen: true };
    }

    const result = await dispatchToProvider(providerId, { baseUrl, timeoutMs });
    await reportOutcome(providerId, result.outcome);
    return result;
  };

  // idempotencyKey is optional and per-CALL here — the caller decides the
  // granularity (api/transactionProcessor.js applies it at the whole-
  // transaction level, not per attempt; see idempotency.js's own comment).
  if (idempotencyKey) {
    return idempotencyGuard.execute(idempotencyKey, run);
  }
  return run();
}

module.exports = { executeDispatch, defaultIdempotencyGuard };
