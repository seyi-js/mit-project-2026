require('dotenv').config();
const mongoose = require('mongoose');
const request = require('supertest');

const ProviderHealth = require('../src/models/ProviderHealth');
const CircuitBreakerState = require('../src/models/CircuitBreakerState');
const TransactionLog = require('../src/models/TransactionLog');
const { createProvidersApp } = require('../src/providers/app');
const { createApp } = require('../src/app');

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/adaptive-payment-orchestration-test';

let providersServer;
let providersBaseUrl;

beforeAll(async () => {
  await mongoose.connect(TEST_MONGODB_URI);
  const providersApp = createProvidersApp();
  await new Promise((resolve) => {
    providersServer = providersApp.listen(0, () => {
      providersBaseUrl = `http://127.0.0.1:${providersServer.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  providersServer.closeAllConnections();
  await new Promise((resolve) => providersServer.close(resolve));
});

beforeEach(async () => {
  await ProviderHealth.deleteMany({});
  await CircuitBreakerState.deleteMany({});
  await TransactionLog.deleteMany({});
  await Promise.all(
    ['A', 'B', 'C'].map((p) => fetch(`${providersBaseUrl}/providers/${p}/fault`, { method: 'DELETE' }))
  );
});

function buildApp() {
  return createApp({ providersBaseUrl, providersTimeoutMs: 100 });
}

describe('GET /health', () => {
  test('responds ok', async () => {
    await request(buildApp()).get('/health').expect(200, { status: 'ok' });
  });
});

describe('strategy admin endpoints', () => {
  test('no strategy is active by default', async () => {
    const res = await request(buildApp()).get('/strategy');
    expect(res.body).toEqual({ strategy: null });
  });

  test('rejects an unknown strategy name', async () => {
    await request(buildApp()).put('/strategy').send({ strategy: 'not-a-strategy' }).expect(400);
  });

  test('activates a known strategy and reflects it back', async () => {
    const app = buildApp();
    await request(app).put('/strategy').send({ strategy: 'single-provider', options: { providerId: 'B' } }).expect(200);
    const res = await request(app).get('/strategy');
    expect(res.body).toEqual({ strategy: 'single-provider' });
  });

  test('strategy state is independent per app instance', async () => {
    const appA = buildApp();
    const appB = buildApp();
    await request(appA).put('/strategy').send({ strategy: 'single-provider' }).expect(200);

    const resA = await request(appA).get('/strategy');
    const resB = await request(appB).get('/strategy');
    expect(resA.body.strategy).toBe('single-provider');
    expect(resB.body.strategy).toBeNull();
  });
});

describe('POST /transactions', () => {
  test('rejects when no strategy has been activated yet', async () => {
    await request(buildApp()).post('/transactions').send({}).expect(400);
  });

  test('processes a successful transaction end to end', async () => {
    const app = buildApp();
    await request(app).put('/strategy').send({ strategy: 'single-provider', options: { providerId: 'A' } });

    const res = await request(app).post('/transactions').send({ runId: 'run-http-1', transactionIndex: 0 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ finalOutcome: 'success', strategy: 'single-provider' });
    expect(res.body.attempts).toHaveLength(1);

    const doc = await TransactionLog.findById(res.body.transactionLogId);
    expect(doc.finalOutcome).toBe('success');
  });

  test('cascading failover retries across providers via the real HTTP route', async () => {
    await fetch(`${providersBaseUrl}/providers/A/fault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultType: 'full_outage' }),
    });

    const app = buildApp();
    await request(app).put('/strategy').send({ strategy: 'cascading-failover' });

    const res = await request(app).post('/transactions').send({ runId: 'run-http-2' });

    expect(res.body.finalOutcome).toBe('success');
    expect(res.body.attempts.map((a) => a.providerId)).toEqual(['A', 'B']);
  }, 10000);
});
