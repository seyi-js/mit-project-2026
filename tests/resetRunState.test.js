require('dotenv').config();
const mongoose = require('mongoose');

const ProviderHealth = require('../src/models/ProviderHealth');
const CircuitBreakerState = require('../src/models/CircuitBreakerState');
const { resetRunState } = require('../src/experiment/resetRunState');
const { PROVIDERS, NEUTRAL_HEALTH_SCORE } = require('../src/config/constants');

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/adaptive-payment-orchestration-test';

beforeAll(async () => {
  await mongoose.connect(TEST_MONGODB_URI);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await ProviderHealth.deleteMany({});
  await CircuitBreakerState.deleteMany({});
});

describe('resetRunState', () => {
  test('resets a dirty HealthScore and observation history back to neutral for every provider', async () => {
    await ProviderHealth.create([
      { providerId: 'A', healthScore: 0.1, recentObservations: [{ timestamp: new Date(), latencyMs: 3000, errorIndicator: 1, timeoutIndicator: 1 }] },
      { providerId: 'B', healthScore: 0.9, recentObservations: [] },
    ]);

    await resetRunState();

    for (const providerId of PROVIDERS) {
      // eslint-disable-next-line no-await-in-loop
      const doc = await ProviderHealth.findOne({ providerId });
      expect(doc.healthScore).toBe(NEUTRAL_HEALTH_SCORE);
      expect(doc.recentObservations).toHaveLength(0);
    }
  });

  test('resets a tripped circuit breaker back to closed for every provider', async () => {
    await CircuitBreakerState.create({
      providerId: 'A',
      state: 'open',
      consecutiveFailures: 5,
      blockedAttempts: 12,
      openedAt: new Date(),
      lastFailureAt: new Date(),
    });

    await resetRunState();

    for (const providerId of PROVIDERS) {
      // eslint-disable-next-line no-await-in-loop
      const doc = await CircuitBreakerState.findOne({ providerId });
      expect(doc.state).toBe('closed');
      expect(doc.consecutiveFailures).toBe(0);
      expect(doc.blockedAttempts).toBe(0);
      expect(doc.openedAt).toBeNull();
    }
  });

  test('creates documents for providers that have none yet', async () => {
    await resetRunState();
    const count = await ProviderHealth.countDocuments({});
    expect(count).toBe(PROVIDERS.length);
  });
});
