require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const request = require('supertest');

const ProviderHealth = require('../src/models/ProviderHealth');
const { recordObservation } = require('../src/monitor/monitor');
const { createMonitorMiddleware } = require('../src/monitor/middleware');
const { ROLLING_WINDOW_SIZE } = require('../src/config/constants');

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

describe('recordObservation', () => {
  test('creates the provider document on first observation (upsert)', async () => {
    await recordObservation({ providerId: 'A', latencyMs: 120, outcome: 'success' });
    const doc = await ProviderHealth.findOne({ providerId: 'A' });
    expect(doc.recentObservations).toHaveLength(1);
    expect(doc.recentObservations[0]).toMatchObject({
      latencyMs: 120,
      errorIndicator: 0,
      timeoutIndicator: 0,
    });
  });

  test('derives errorIndicator from an error outcome', async () => {
    await recordObservation({ providerId: 'A', latencyMs: 80, outcome: 'error' });
    const doc = await ProviderHealth.findOne({ providerId: 'A' });
    expect(doc.recentObservations[0]).toMatchObject({ errorIndicator: 1, timeoutIndicator: 0 });
  });

  test('derives timeoutIndicator from a timeout outcome', async () => {
    await recordObservation({ providerId: 'A', latencyMs: 3000, outcome: 'timeout' });
    const doc = await ProviderHealth.findOne({ providerId: 'A' });
    expect(doc.recentObservations[0]).toMatchObject({ errorIndicator: 0, timeoutIndicator: 1 });
  });

  test('keeps only the most recent ROLLING_WINDOW_SIZE observations', async () => {
    for (let i = 0; i < ROLLING_WINDOW_SIZE + 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await recordObservation({ providerId: 'A', latencyMs: i, outcome: 'success' });
    }
    const doc = await ProviderHealth.findOne({ providerId: 'A' });
    expect(doc.recentObservations).toHaveLength(ROLLING_WINDOW_SIZE);
    expect(doc.recentObservations[doc.recentObservations.length - 1].latencyMs).toBe(
      ROLLING_WINDOW_SIZE + 4
    );
  }, 20000);

  test('rejects an unknown providerId', async () => {
    await expect(
      recordObservation({ providerId: 'Z', latencyMs: 10, outcome: 'success' })
    ).rejects.toThrow();
  });

  test('rejects an unknown outcome', async () => {
    await expect(
      recordObservation({ providerId: 'A', latencyMs: 10, outcome: 'bogus' })
    ).rejects.toThrow();
  });
});

describe('monitor middleware', () => {
  function buildApp() {
    const app = express();
    app.use(createMonitorMiddleware());
    app.post('/dispatch/:providerId', (req, res) => {
      res.locals.dispatchObservation = {
        providerId: req.params.providerId,
        latencyMs: 42,
        outcome: 'success',
      };
      res.json({ ok: true });
    });
    app.post('/no-observation', (req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  test('persists the observation set on res.locals after the response finishes', async () => {
    const app = buildApp();
    await request(app).post('/dispatch/B').expect(200);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const doc = await ProviderHealth.findOne({ providerId: 'B' });
    expect(doc.recentObservations).toHaveLength(1);
    expect(doc.recentObservations[0]).toMatchObject({ latencyMs: 42, errorIndicator: 0 });
  });

  test('does nothing when no dispatchObservation was set', async () => {
    const app = buildApp();
    await request(app).post('/no-observation').expect(200);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const docs = await ProviderHealth.find({});
    expect(docs).toHaveLength(0);
  });
});
