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
      return { providerId, latencyMs: 0, outcome: 'error', circuitOpen: true };
    }

    const result = await dispatchToProvider(providerId, { baseUrl, timeoutMs });
    await reportOutcome(providerId, result.outcome);
    return result;
  };

  if (idempotencyKey) {
    return idempotencyGuard.execute(idempotencyKey, run);
  }
  return run();
}

module.exports = { executeDispatch, defaultIdempotencyGuard };
