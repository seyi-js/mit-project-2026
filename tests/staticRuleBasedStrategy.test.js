require('dotenv').config();
const mongoose = require('mongoose');

const RoutingConfig = require('../src/models/RoutingConfig');
const { createStaticRuleBasedStrategy } = require('../src/planner/strategies/staticRuleBasedStrategy');

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
  await RoutingConfig.deleteMany({});
});

describe('static-rule-based strategy', () => {
  test('throws if no RoutingConfig has been set for the run', async () => {
    const strategy = createStaticRuleBasedStrategy();
    await expect(strategy.selectProvider({ attemptNumber: 1, excludedProviders: [] })).rejects.toThrow();
  });

  test('selects a provider according to the configured weights', async () => {
    await RoutingConfig.create({ weights: { A: 0.5, B: 0.3, C: 0.2 } });
    const strategy = createStaticRuleBasedStrategy({ random: () => 0.1 });
    expect(await strategy.selectProvider({ attemptNumber: 1, excludedProviders: [] })).toBe('A');
  });

  test('never falls back on a second attempt (no retry for this strategy)', async () => {
    await RoutingConfig.create({ weights: { A: 0.5, B: 0.3, C: 0.2 } });
    const strategy = createStaticRuleBasedStrategy();
    expect(await strategy.selectProvider({ attemptNumber: 2, excludedProviders: ['A'] })).toBeNull();
  });

  test('never updates the stored weights at runtime (write once, read-only)', async () => {
    await RoutingConfig.create({ weights: { A: 0.5, B: 0.3, C: 0.2 } });
    const strategy = createStaticRuleBasedStrategy();

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await strategy.selectProvider({ attemptNumber: 1, excludedProviders: [] });
    }

    const configs = await RoutingConfig.find({});
    expect(configs).toHaveLength(1);
    expect(configs[0].weights).toMatchObject({ A: 0.5, B: 0.3, C: 0.2 });
  });
});
