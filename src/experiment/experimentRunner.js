// Runs ONE experimental run (Section 9): one strategy, dispatched against the
// fixed fault schedule, for `transactionsPerRun` transactions. Looping this
// across all 4 strategies x 10 repetitions (the full 40-run experiment) is
// runAll.js's job, not this file's — this module only knows how to do a
// single run correctly and repeatably.

const { createPlanner } = require('../planner/planner'); // builds the active routing strategy (KAN-33)
const { processTransaction } = require('../api/transactionProcessor'); // runs Monitor->Analyser->Planner->Executor for ONE transaction and writes its TransactionLog entry
const { resetRunState } = require('./resetRunState'); // resets ProviderHealth + CircuitBreakerState to a clean baseline
const { ensureFaultScheduleExists, DEFAULT_SCHEDULE_ID } = require('./faultSchedule'); // reads (or creates once) the fixed fault schedule from MongoDB
const { ensureRoutingConfigExists } = require('./routingConfig'); // only needed by the static-rule-based strategy's fixed weights
const { clearAllProviderFaults, applyFaultTransitions } = require('./faultApplier'); // talks to the provider simulators' runtime fault-config API
const { TRANSACTIONS_PER_RUN } = require('../config/constants');

async function runExperiment({
  strategyName,
  strategyOptions = {},
  runId,
  scheduleId = DEFAULT_SCHEDULE_ID,
  transactionsPerRun = TRANSACTIONS_PER_RUN,
  providersBaseUrl,
  timeoutMs,
  onProgress,
} = {}) {
  if (!runId) {
    throw new Error('runId is required');
  }

  // --- Setup: everything Section 9 step 1 ("initialise the service with
  // that strategy active") needs before any transaction is dispatched. ---
  const strategy = createPlanner(strategyName, strategyOptions);

  // Live operational state (HealthScore, circuit breakers) must start clean
  // for every run — otherwise a bad run would bleed into the next one.
  // TransactionLog itself is NOT touched here; it accumulates across all 40 runs.
  await resetRunState();

  // In case a previous run (or a manual test) left a provider mid-fault.
  await clearAllProviderFaults(providersBaseUrl);

  // Fetches the ALREADY-STORED schedule if one exists under this scheduleId,
  // or creates it on the very first call. Every one of the 40 runs ends up
  // replaying this exact same document — that's what "controlled variable"
  // means for the fault schedule.
  const schedule = await ensureFaultScheduleExists(scheduleId);

  // Only the static-rule-based strategy reads RoutingConfig; the other 3
  // strategies never touch it, so we don't create it unconditionally.
  if (strategyName === 'static-rule-based') {
    await ensureRoutingConfigExists();
  }

  // --- Main loop: one iteration per simulated transaction (Section 9 step 3). ---
  for (let transactionIndex = 0; transactionIndex < transactionsPerRun; transactionIndex += 1) {
    // Turns any fault ON/OFF whose start/end index equals the current one.
    // Most iterations are a no-op here (the schedule only has ~7 events
    // spread across all 10,000 indices).
    // eslint-disable-next-line no-await-in-loop
    await applyFaultTransitions(schedule.events, transactionIndex, providersBaseUrl);

    // Does the real work for this one transaction: asks the strategy which
    // provider to try, dispatches through the Executor (circuit breaker +
    // idempotency), records the observation/HealthScore update, retries per
    // the strategy's own rules, and persists the outcome to TransactionLog.
    // eslint-disable-next-line no-await-in-loop
    await processTransaction({
      strategy,
      strategyName,
      runId,
      transactionIndex,
      baseUrl: providersBaseUrl,
      timeoutMs,
    });

    // Not every transaction — just a periodic heartbeat so a caller (e.g.
    // runAll.js's console output) can show progress during a long run.
    if (onProgress && transactionIndex % 500 === 0) {
      onProgress({ runId, transactionIndex, transactionsPerRun });
    }
  }

  // Leave providers in a clean state rather than mid-fault when the run ends.
  await clearAllProviderFaults(providersBaseUrl);

  return { runId, strategyName, transactionsPerRun, scheduleId };
}

module.exports = { runExperiment };
