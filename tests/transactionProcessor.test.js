require('dotenv').config();
const mongoose = require('mongoose');

const ProviderHealth = require('../src/models/ProviderHealth');
const CircuitBreakerState = require('../src/models/CircuitBreakerState');
const TransactionLog = require('../src/models/TransactionLog');
const { createProvidersApp } = require('../src/providers/app');
const { createPlanner } = require('../src/planner/planner');
const { processTransaction } = require('../src/api/transactionProcessor');
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
  await ProviderHealth.deleteMany({});
  await CircuitBreakerState.deleteMany({});
  await TransactionLog.deleteMany({});
  await Promise.all(
    ['A', 'B', 'C'].map((p) => fetch(`${baseUrl}/providers/${p}/fault`, { method: 'DELETE' }))
  );
});

describe('processTransaction', () => {
  test('a healthy single-provider transaction succeeds on the first attempt', async () => {
    const strategy = createPlanner('single-provider', { providerId: 'A' });
    const result = await processTransaction({
      strategy,
      strategyName: 'single-provider',
      runId: 'run-1',
      transactionIndex: 0,
      baseUrl,
    });

    expect(result.finalOutcome).toBe('success');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ providerId: 'A', outcome: 'success' });

    const doc = await TransactionLog.findById(result.transactionLogId);
    expect(doc.finalOutcome).toBe('success');
    expect(doc.strategy).toBe('single-provider');

    const health = await ProviderHealth.findOne({ providerId: 'A' });
    expect(health.recentObservations).toHaveLength(1);
  });

  test('cascading failover retries the next provider after a failure and succeeds', async () => {
    await fetch(`${baseUrl}/providers/A/fault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultType: 'full_outage' }),
    });

    const strategy = createPlanner('cascading-failover');
    const result = await processTransaction({
      strategy,
      strategyName: 'cascading-failover',
      baseUrl,
      timeoutMs: 100,
    });

    expect(result.finalOutcome).toBe('success');
    expect(result.attempts.map((a) => a.providerId)).toEqual(['A', 'B']);
    expect(result.attempts[0].outcome).toBe('timeout');
    expect(result.attempts[1].outcome).toBe('success');
  }, 10000);

  test('exhausting all providers marks the transaction failed', async () => {
    await Promise.all(
      ['A', 'B', 'C'].map((p) =>
        fetch(`${baseUrl}/providers/${p}/fault`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ faultType: 'full_outage' }),
        })
      )
    );

    const strategy = createPlanner('cascading-failover');
    const result = await processTransaction({ strategy, strategyName: 'cascading-failover', baseUrl, timeoutMs: 100 });

    expect(result.finalOutcome).toBe('failed');
    expect(result.attempts).toHaveLength(3);

    const doc = await TransactionLog.findById(result.transactionLogId);
    expect(doc.finalOutcome).toBe('failed');
  }, 10000);

  test('a circuit-open short-circuit is logged as an attempt but does not record a Monitor observation', async () => {
    await fetch(`${baseUrl}/providers/A/fault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultType: 'full_outage' }),
    });

    // Trip the breaker for A with 5 prior failures via repeated single-attempt transactions.
    for (let i = 0; i < 5; i += 1) {
      const strategy = createPlanner('single-provider', { providerId: 'A' });
      // eslint-disable-next-line no-await-in-loop
      await processTransaction({ strategy, strategyName: 'single-provider', baseUrl, timeoutMs: 100 });
    }

    const breaker = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(breaker.state).toBe('open');

    const observationsBefore = (await ProviderHealth.findOne({ providerId: 'A' })).recentObservations.length;

    const strategy = createPlanner('single-provider', { providerId: 'A' });
    const result = await processTransaction({ strategy, strategyName: 'single-provider', baseUrl, timeoutMs: 100 });

    expect(result.finalOutcome).toBe('failed');
    expect(result.attempts[0].outcome).toBe('error');

    const observationsAfter = (await ProviderHealth.findOne({ providerId: 'A' })).recentObservations.length;
    expect(observationsAfter).toBe(observationsBefore);
  }, 15000);

  test('the adaptive strategy reacts to a degraded first attempt when retrying', async () => {
    await ProviderHealth.create([
      { providerId: 'A', healthScore: 0.9 },
      { providerId: 'B', healthScore: 0.6 },
      { providerId: 'C', healthScore: 0.3 },
    ]);
    await fetch(`${baseUrl}/providers/A/fault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultType: 'full_outage' }),
    });

    const strategy = createPlanner('adaptive-health-scored', { random: () => 0.1 }); // forces primary allocation
    const result = await processTransaction({
      strategy,
      strategyName: 'adaptive-health-scored',
      baseUrl,
      timeoutMs: 100,
    });

    expect(result.attempts[0]).toMatchObject({ providerId: 'A', outcome: 'timeout' });
    expect(result.attempts[1]).toMatchObject({ providerId: 'B', outcome: 'success' });
    expect(result.finalOutcome).toBe('success');

    const healthA = await ProviderHealth.findOne({ providerId: 'A' });
    expect(healthA.healthScore).toBeLessThan(0.9);
  }, 10000);

  test('a repeated transactionId returns the same result without creating a second TransactionLog', async () => {
    const idempotencyGuard = new IdempotencyGuard();
    const makeCall = () =>
      processTransaction({
        strategy: createPlanner('single-provider', { providerId: 'A' }),
        strategyName: 'single-provider',
        baseUrl,
        transactionId: 'txn-dedupe-1',
        idempotencyGuard,
      });

    const [first, second] = await Promise.all([makeCall(), makeCall()]);
    expect(first).toBe(second);

    const count = await TransactionLog.countDocuments({});
    expect(count).toBe(1);
  });
});
