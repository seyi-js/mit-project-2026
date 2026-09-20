// THIS is the actual Monitor -> Analyser -> Planner -> Executor wiring
// (KAN-42) — every other module in the pipeline is a building block this
// function assembles for one transaction. If you're trying to understand
// "how does a request actually flow through the system," start here.
//
// Note this calls recordObservation/updateHealthScore directly (synchronous,
// awaited), NOT via monitor/middleware.js's res.locals pattern — see that
// file's own comment for why: the adaptive strategy needs each attempt's
// freshly-updated HealthScore before it can pick the next provider, which
// only works if these calls happen inline, in order, inside the retry loop.
const TransactionLog = require('../models/TransactionLog');
const { recordObservation, deriveIndicators } = require('../monitor/monitor');
const { updateHealthScore } = require('../analyser/analyser');
const { executeDispatch } = require('../executor/executor');
const { IdempotencyGuard } = require('../executor/idempotency');

const defaultTransactionIdempotencyGuard = new IdempotencyGuard();

async function processTransaction({
  strategy,
  strategyName,
  runId = 'manual',
  transactionIndex = 0,
  transactionId = null,
  baseUrl,
  timeoutMs,
  idempotencyGuard = defaultTransactionIdempotencyGuard,
} = {}) {
  const run = async () => {
    const attempts = [];
    const excludedProviders = []; // providers already tried THIS transaction — passed to the strategy so it doesn't repeat one
    let finalOutcome = 'failed';
    let attemptNumber = 1;

    // Loop ends one of two ways: a dispatch succeeds (break below), or the
    // strategy itself returns null — meaning it has nothing left to offer
    // (out of attempts, or out of providers, strategy-dependent; see each
    // strategy file's own selectProvider for its specific stopping rule).
    while (true) {
      const providerId = await strategy.selectProvider({ attemptNumber, excludedProviders });
      if (!providerId) break;

      const dispatchedAt = new Date();
      const result = await executeDispatch({ providerId, baseUrl, timeoutMs });

      // A circuitOpen short-circuit still gets logged as an attempt (as
      // 'error') for a complete audit trail, but see below — it's excluded
      // from the Monitor/Analyser update since it isn't a real observation.
      attempts.push({
        attemptNumber,
        providerId,
        dispatchedAt,
        respondedAt: new Date(),
        latencyMs: result.latencyMs,
        outcome: result.circuitOpen ? 'error' : result.outcome,
      });

      // Skip Monitor/Analyser when the breaker short-circuited: the provider
      // was never actually contacted, so there's no genuine signal about its
      // behaviour to record — feeding in a synthetic result here would
      // pollute the HealthScore with a non-observation.
      if (!result.circuitOpen) {
        const { errorIndicator, timeoutIndicator } = deriveIndicators(result.outcome);
        await recordObservation({ providerId, latencyMs: result.latencyMs, outcome: result.outcome });
        await updateHealthScore({ providerId, latencyMs: result.latencyMs, errorIndicator, timeoutIndicator });
      }

      if (result.outcome === 'success') {
        finalOutcome = 'success';
        break;
      }

      // Not a success (and not a break above) -> this provider is done for
      // this transaction; exclude it and ask the strategy for the next one.
      excludedProviders.push(providerId);
      attemptNumber += 1;
    }

    // The permanent experimental record — one document per transaction,
    // written exactly once here regardless of how many attempts it took.
    const transactionLog = await TransactionLog.create({
      runId,
      strategy: strategyName,
      transactionIndex,
      attempts,
      finalOutcome,
      completedAt: new Date(),
    });

    return {
      runId,
      transactionIndex,
      strategy: strategyName,
      finalOutcome,
      attempts,
      transactionLogId: transactionLog._id,
    };
  };

  // transactionId is OPTIONAL, whole-transaction-level idempotency (not the
  // per-attempt idempotencyKey executeDispatch also supports) — protects
  // against the entire retry sequence running twice if the same transaction
  // gets submitted again (e.g. a client retrying after a dropped response),
  // which could otherwise double-process across providers.
  if (transactionId) {
    return idempotencyGuard.execute(transactionId, run);
  }
  return run();
}

module.exports = { processTransaction };
