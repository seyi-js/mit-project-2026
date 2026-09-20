// Single source of truth for every fixed value and enum in the system.
// Every hyperparameter from Chapter 3 (Section 4/5/6/8) lives here, exactly
// as specified, so it can be imported instead of re-typed/hardcoded in each
// module — and so the Chapter 4 sensitivity analyses (weights, degradation
// threshold) have one place to override from. A few values below (marked
// explicitly) are NOT from the brief — they're implementation defaults for
// mechanics the brief describes but doesn't pin exact numbers for.

const PROVIDERS = ['A', 'B', 'C'];

const ROUTING_STRATEGIES = [
  'single-provider',
  'static-rule-based',
  'cascading-failover',
  'adaptive-health-scored',
];

const FAULT_TYPES = [
  'degraded_latency',
  'elevated_error_rate',
  'intermittent_timeout',
  'full_outage',
];

const CIRCUIT_BREAKER_STATES = ['closed', 'open', 'half_open'];

const ATTEMPT_OUTCOMES = ['success', 'error', 'timeout'];

const FINAL_OUTCOMES = ['success', 'failed'];

const BINARY_INDICATOR = [0, 1]; // shape of e(t)/o(t) in Section 4 — used as the enum for a raw observation's error/timeout flags

// Section 4 Step 1's exact latency-normalisation bounds.
const TIMING = {
  T_TIMEOUT_MS: 3000,
  L_MIN_MS: 100,
  L_MAX_MS: 3000, // == T_TIMEOUT_MS
  L_ACCEPTABLE_MS: 500, // sanity-check benchmark only, not used in any formula
};

// Section 4 Step 2 — how much latency/errors/timeouts each count against a
// single transaction's observed_value(t). Passed as a default into
// analyser/healthScore.js's computeObservedValue, overridable per Chapter 4's
// weight sensitivity analysis.
const HEALTH_SCORE_WEIGHTS = {
  w1_latency: 0.25,
  w2_error: 0.5,
  w3_timeout: 0.25,
};

// Section 4 Step 3's alpha — how much a single new transaction moves the
// running HealthScore vs. how much of the old score survives (EWMA blend).
const HEALTH_SCORE_SMOOTHING_ALPHA = 0.3;

// Section 4 Step 4. Below this, the Planner's adaptive strategy deprioritises
// (not excludes) a provider. Chapter 4 also runs this at 0.4 and 0.6.
const DEGRADATION_THRESHOLD_DEFAULT = 0.5;
// What every provider's HealthScore is reset to at the start of a run
// (resetRunState) and what a provider defaults to if it has no ProviderHealth
// document yet (i.e. no observations recorded so far).
const NEUTRAL_HEALTH_SCORE = 0.5;

// Section 5 & 8. Single-provider and static-rule-based never retry at all
// (they return null from selectProvider after attempt 1, ignoring this
// constant); only cascading-failover and adaptive-health-scored use it, and
// they must both use THIS SAME value — it's a controlled variable between them.
const MAX_DISPATCH_ATTEMPTS = 3;

// Section 5's adaptive strategy: 90% of first-attempt traffic to the current
// top-ranked provider, 10% ("exploration") split evenly across the other two
// so their HealthScores keep getting refreshed with real traffic even while
// they're not preferred. Only applies to attempt 1 — retries are always
// deterministic (next-highest remaining), see adaptiveHealthScoredStrategy.js.
const ADAPTIVE_STRATEGY = {
  PRIMARY_ALLOCATION: 0.9,
  EXPLORATION_ALLOCATION: 0.1,
};

const ROLLING_WINDOW_SIZE = 200; // observations retained per provider for Monitor history

// Not specified in Chapter 3 — implementation defaults for the Executor's
// circuit breaker (a mechanic the brief requires but doesn't give numbers
// for). Shared identically across all 4 strategies regardless: N consecutive
// failures opens the breaker; after RESET_AFTER_BLOCKED_ATTEMPTS further
// dispatch attempts get short-circuited, it allows a half-open probe.
//
// Deliberately a TRANSACTION-COUNT cooldown, not a wall-clock one — an
// earlier version used RESET_TIMEOUT_MS (real milliseconds), which caused a
// real bug: once opened, blocked dispatches are near-instant (no network
// call), so thousands of transactions can complete faster than any fixed
// millisecond timer, permanently stranding the breaker open for the rest of
// a run. Since every other clock in this system (the fault schedule, the
// metrics) is transaction-count-based, the breaker's recovery needs to be
// too, so it can't be outrun by however fast the underlying hardware happens
// to process requests. See executor/circuitBreaker.js for the state machine.
const CIRCUIT_BREAKER = {
  FAILURE_THRESHOLD: 5,
  RESET_AFTER_BLOCKED_ATTEMPTS: 20,
};

// Section 6/9: 10,000 transactions per run, 10 runs per strategy (x4
// strategies = 40 total runs). runAll.js is what actually loops over these.
const TRANSACTIONS_PER_RUN = 10000;
const RUNS_PER_STRATEGY = 10;

module.exports = {
  PROVIDERS,
  ROUTING_STRATEGIES,
  FAULT_TYPES,
  CIRCUIT_BREAKER_STATES,
  ATTEMPT_OUTCOMES,
  FINAL_OUTCOMES,
  BINARY_INDICATOR,
  TIMING,
  HEALTH_SCORE_WEIGHTS,
  HEALTH_SCORE_SMOOTHING_ALPHA,
  DEGRADATION_THRESHOLD_DEFAULT,
  NEUTRAL_HEALTH_SCORE,
  MAX_DISPATCH_ATTEMPTS,
  ADAPTIVE_STRATEGY,
  ROLLING_WINDOW_SIZE,
  CIRCUIT_BREAKER,
  TRANSACTIONS_PER_RUN,
  RUNS_PER_STRATEGY,
};
