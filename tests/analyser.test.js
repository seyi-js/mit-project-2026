require('dotenv').config();
const mongoose = require('mongoose');

const ProviderHealth = require('../src/models/ProviderHealth');
const { updateHealthScore } = require('../src/analyser/analyser');
const { NEUTRAL_HEALTH_SCORE } = require('../src/config/constants');

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

describe('updateHealthScore', () => {
  test('starts blending from the neutral baseline when no provider doc exists yet', async () => {
    const result = await updateHealthScore({
      providerId: 'A',
      latencyMs: 100,
      errorIndicator: 0,
      timeoutIndicator: 0,
    });

    expect(result.healthScore).toBeCloseTo(0.3 * 1 + 0.7 * NEUTRAL_HEALTH_SCORE);
    expect(result.degraded).toBe(false);

    const doc = await ProviderHealth.findOne({ providerId: 'A' });
    expect(doc.healthScore).toBeCloseTo(result.healthScore);
  });

  test('blends against the previously persisted HealthScore on subsequent calls', async () => {
    const first = await updateHealthScore({
      providerId: 'A',
      latencyMs: 100,
      errorIndicator: 0,
      timeoutIndicator: 0,
    });
    const second = await updateHealthScore({
      providerId: 'A',
      latencyMs: 3000,
      errorIndicator: 1,
      timeoutIndicator: 1,
    });

    expect(second.observedValue).toBeCloseTo(0);
    expect(second.healthScore).toBeCloseTo(0.3 * 0 + 0.7 * first.healthScore);
    expect(second.healthScore).toBeLessThan(first.healthScore);
  });

  test('reports degraded once the HealthScore drops below the given threshold', async () => {
    let result;
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      result = await updateHealthScore({
        providerId: 'B',
        latencyMs: 3000,
        errorIndicator: 1,
        timeoutIndicator: 1,
        threshold: 0.5,
      });
    }
    expect(result.healthScore).toBeLessThan(0.5);
    expect(result.degraded).toBe(true);
  });

  test('rejects an unknown providerId', async () => {
    await expect(
      updateHealthScore({ providerId: 'Z', latencyMs: 100, errorIndicator: 0, timeoutIndicator: 0 })
    ).rejects.toThrow();
  });

  test('keeps per-provider HealthScore independent', async () => {
    await updateHealthScore({ providerId: 'A', latencyMs: 3000, errorIndicator: 1, timeoutIndicator: 1 });
    await updateHealthScore({ providerId: 'C', latencyMs: 100, errorIndicator: 0, timeoutIndicator: 0 });

    const a = await ProviderHealth.findOne({ providerId: 'A' });
    const c = await ProviderHealth.findOne({ providerId: 'C' });
    expect(a.healthScore).toBeLessThan(c.healthScore);
  });
});
