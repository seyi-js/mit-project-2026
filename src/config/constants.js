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

const BINARY_INDICATOR = [0, 1];

const TIMING = {
  T_TIMEOUT_MS: 3000,
  L_MIN_MS: 100,
  L_MAX_MS: 3000, // == T_TIMEOUT_MS
  L_ACCEPTABLE_MS: 500, // sanity-check benchmark only, not used in any formula
};

const HEALTH_SCORE_WEIGHTS = {
  w1_latency: 0.25,
  w2_error: 0.5,
  w3_timeout: 0.25,
};

const HEALTH_SCORE_SMOOTHING_ALPHA = 0.3;

const DEGRADATION_THRESHOLD_DEFAULT = 0.5;
const NEUTRAL_HEALTH_SCORE = 0.5;

const MAX_DISPATCH_ATTEMPTS = 3; // shared by cascading-failover and adaptive strategies

const ADAPTIVE_STRATEGY = {
  PRIMARY_ALLOCATION: 0.9, // to the highest-HealthScore provider
  EXPLORATION_ALLOCATION: 0.1, // split evenly across the other providers
};

const ROLLING_WINDOW_SIZE = 200; // observations retained per provider for Monitor history

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
  TRANSACTIONS_PER_RUN,
  RUNS_PER_STRATEGY,
};
