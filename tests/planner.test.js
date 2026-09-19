require('dotenv').config();
const mongoose = require('mongoose');

const { createPlanner } = require('../src/planner/planner');
const { ROUTING_STRATEGIES, MAX_DISPATCH_ATTEMPTS } = require('../src/config/constants');

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/adaptive-payment-orchestration-test';

beforeAll(async () => {
  await mongoose.connect(TEST_MONGODB_URI);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('createPlanner', () => {
  test('creates a strategy instance for each of the 4 known routing strategies', () => {
    for (const strategyName of ROUTING_STRATEGIES) {
      const strategy = createPlanner(strategyName);
      expect(strategy.name).toBe(strategyName);
      expect(typeof strategy.selectProvider).toBe('function');
    }
  });

  test('throws for an unknown strategy name', () => {
    expect(() => createPlanner('not-a-real-strategy')).toThrow();
  });

  test('cascading-failover and adaptive-health-scored both stop at the same shared MAX_DISPATCH_ATTEMPTS', async () => {
    const cascading = createPlanner('cascading-failover');
    const adaptive = createPlanner('adaptive-health-scored');
    const excludedProviders = ['A', 'B', 'C'].slice(0, MAX_DISPATCH_ATTEMPTS);

    expect(
      await cascading.selectProvider({ attemptNumber: MAX_DISPATCH_ATTEMPTS + 1, excludedProviders })
    ).toBeNull();
    expect(
      await adaptive.selectProvider({ attemptNumber: MAX_DISPATCH_ATTEMPTS + 1, excludedProviders })
    ).toBeNull();
  });
});
