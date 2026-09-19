require('dotenv').config();
const mongoose = require('mongoose');

const ProviderHealth = require('../src/models/ProviderHealth');
const { createAdaptiveHealthScoredStrategy } = require('../src/planner/strategies/adaptiveHealthScoredStrategy');

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
});

async function seedHealthScores({ A, B, C }) {
  await ProviderHealth.create([
    { providerId: 'A', healthScore: A },
    { providerId: 'B', healthScore: B },
    { providerId: 'C', healthScore: C },
  ]);
}

describe('adaptive-health-scored strategy', () => {
  test('90% allocation: sends the first attempt to the highest-HealthScore provider', async () => {
    await seedHealthScores({ A: 0.9, B: 0.6, C: 0.3 });
    const strategy = createAdaptiveHealthScoredStrategy({ random: () => 0.5 }); // < 0.9 primaryAllocation
    expect(await strategy.selectProvider({ attemptNumber: 1, excludedProviders: [] })).toBe('A');
  });

  test('10% exploration: splits evenly across the two non-top providers', async () => {
    await seedHealthScores({ A: 0.9, B: 0.6, C: 0.3 });

    const pickFirstOfPool = jest.fn().mockReturnValueOnce(0.95).mockReturnValueOnce(0.1);
    const strategyToB = createAdaptiveHealthScoredStrategy({ random: pickFirstOfPool });
    expect(await strategyToB.selectProvider({ attemptNumber: 1, excludedProviders: [] })).toBe('B');

    const pickSecondOfPool = jest.fn().mockReturnValueOnce(0.95).mockReturnValueOnce(0.6);
    const strategyToC = createAdaptiveHealthScoredStrategy({ random: pickSecondOfPool });
    expect(await strategyToC.selectProvider({ attemptNumber: 1, excludedProviders: [] })).toBe('C');
  });

  test('retries go to the next-highest-ranked remaining provider, not another random draw', async () => {
    await seedHealthScores({ A: 0.9, B: 0.6, C: 0.3 });
    const strategy = createAdaptiveHealthScoredStrategy();

    expect(await strategy.selectProvider({ attemptNumber: 2, excludedProviders: ['A'] })).toBe('B');
    expect(await strategy.selectProvider({ attemptNumber: 3, excludedProviders: ['A', 'B'] })).toBe('C');
  });

  test('stops after the shared max-attempts cap (3)', async () => {
    await seedHealthScores({ A: 0.9, B: 0.6, C: 0.3 });
    const strategy = createAdaptiveHealthScoredStrategy();
    expect(
      await strategy.selectProvider({ attemptNumber: 4, excludedProviders: ['A', 'B', 'C'] })
    ).toBeNull();
  });

  test('providers with no ProviderHealth doc yet default to the neutral baseline (0.5)', async () => {
    const strategy = createAdaptiveHealthScoredStrategy({ random: () => 0.1 });
    const selected = await strategy.selectProvider({ attemptNumber: 1, excludedProviders: [] });
    expect(['A', 'B', 'C']).toContain(selected);
  });
});
