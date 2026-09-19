require('dotenv').config();
const mongoose = require('mongoose');

const CircuitBreakerState = require('../src/models/CircuitBreakerState');
const { createProvidersApp } = require('../src/providers/app');
const { executeDispatch } = require('../src/executor/executor');
const { IdempotencyGuard } = require('../src/executor/idempotency');

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/adaptive-payment-orchestration-test';

let server;
let baseUrl;

beforeAll(async () => {
  await mongoose.connect(TEST_MONGODB_URI);
  const app = createProvidersApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await CircuitBreakerState.deleteMany({});
  await fetch(`${baseUrl}/providers/A/fault`, { method: 'DELETE' });
});

describe('executeDispatch', () => {
  test('dispatches successfully to a healthy provider', async () => {
    const result = await executeDispatch({ providerId: 'A', baseUrl });
    expect(result).toMatchObject({ providerId: 'A', outcome: 'success' });
  });

  test('repeated failures trip the circuit breaker, then further dispatches short-circuit', async () => {
    await fetch(`${baseUrl}/providers/A/fault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultType: 'full_outage' }),
    });

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await executeDispatch({ providerId: 'A', baseUrl, timeoutMs: 100 });
    }

    const result = await executeDispatch({ providerId: 'A', baseUrl, timeoutMs: 100 });
    expect(result.circuitOpen).toBe(true);

    const doc = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(doc.state).toBe('open');
  }, 15000);

  test('concurrent dispatches with the same idempotencyKey hit the provider only once', async () => {
    await fetch(`${baseUrl}/providers/A/fault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultType: 'degraded_latency', params: { latencyMs: 150 } }),
    });

    const idempotencyGuard = new IdempotencyGuard();
    const [first, second] = await Promise.all([
      executeDispatch({ providerId: 'A', baseUrl, idempotencyKey: 'txn-1', idempotencyGuard }),
      executeDispatch({ providerId: 'A', baseUrl, idempotencyKey: 'txn-1', idempotencyGuard }),
    ]);

    // Same object reference: only possible if the second call was served
    // from the idempotency cache rather than triggering its own dispatch.
    expect(first).toBe(second);
  });

  test('a dispatch without an idempotencyKey is never deduped', async () => {
    const first = await executeDispatch({ providerId: 'A', baseUrl });
    const second = await executeDispatch({ providerId: 'A', baseUrl });
    expect(first).not.toBe(second);
  });
});
