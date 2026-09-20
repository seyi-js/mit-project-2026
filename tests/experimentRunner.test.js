require('dotenv').config();
const mongoose = require('mongoose');

const ProviderHealth = require('../src/models/ProviderHealth');
const CircuitBreakerState = require('../src/models/CircuitBreakerState');
const TransactionLog = require('../src/models/TransactionLog');
const FaultSchedule = require('../src/models/FaultSchedule');
const { createProvidersApp } = require('../src/providers/app');
const { runExperiment } = require('../src/experiment/experimentRunner');

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
  await FaultSchedule.deleteMany({});
});

describe('runExperiment', () => {
  test('resets stale state, replays a stored schedule, and logs one TransactionLog per transaction', async () => {
    // Window is deliberately narrower than CIRCUIT_BREAKER.FAILURE_THRESHOLD (5)
    // so the breaker never trips — this test is about the schedule replay
    // itself, not breaker/fault interaction (which is covered elsewhere).
    await FaultSchedule.create({
      scheduleId: 'test-schedule-small',
      events: [{ providerId: 'A', faultType: 'full_outage', startTransactionIndex: 5, endTransactionIndex: 8, params: {} }],
    });

    // Deliberately dirty prior state to prove the run resets it before starting.
    await CircuitBreakerState.create({ providerId: 'A', state: 'open', consecutiveFailures: 5, blockedAttempts: 15 });

    const result = await runExperiment({
      strategyName: 'single-provider',
      strategyOptions: { providerId: 'A' },
      runId: 'test-run-1',
      scheduleId: 'test-schedule-small',
      transactionsPerRun: 15,
      providersBaseUrl: baseUrl,
      timeoutMs: 100,
    });

    expect(result).toMatchObject({ runId: 'test-run-1', strategyName: 'single-provider', transactionsPerRun: 15 });

    const logs = await TransactionLog.find({ runId: 'test-run-1' }).sort({ transactionIndex: 1 });
    expect(logs).toHaveLength(15);
    expect(logs.every((l) => l.strategy === 'single-provider')).toBe(true);

    const outcomesByIndex = logs.map((l) => l.finalOutcome);
    expect(outcomesByIndex.slice(0, 5)).toEqual(Array(5).fill('success')); // before the fault window
    expect(outcomesByIndex.slice(5, 8)).toEqual(Array(3).fill('failed')); // during full_outage
    expect(outcomesByIndex.slice(8, 15)).toEqual(Array(7).fill('success')); // after it clears

    // The pre-seeded OPEN breaker would have blocked transaction 0 if not reset.
    expect(logs[0].attempts[0].outcome).toBe('success');
  }, 15000);

  test('reuses an already-stored schedule rather than regenerating it', async () => {
    await FaultSchedule.create({
      scheduleId: 'test-schedule-small',
      events: [{ providerId: 'A', faultType: 'full_outage', startTransactionIndex: 2, endTransactionIndex: 4, params: {} }],
    });

    await runExperiment({
      strategyName: 'single-provider',
      strategyOptions: { providerId: 'A' },
      runId: 'test-run-2',
      scheduleId: 'test-schedule-small',
      transactionsPerRun: 5,
      providersBaseUrl: baseUrl,
      timeoutMs: 100,
    });

    const schedules = await FaultSchedule.find({ scheduleId: 'test-schedule-small' });
    expect(schedules).toHaveLength(1);
  }, 15000);
});
