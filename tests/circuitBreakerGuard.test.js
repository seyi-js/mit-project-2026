require('dotenv').config();
const mongoose = require('mongoose');

const CircuitBreakerState = require('../src/models/CircuitBreakerState');
const { canDispatch, reportOutcome } = require('../src/executor/circuitBreakerGuard');

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
  await CircuitBreakerState.deleteMany({});
});

describe('canDispatch / reportOutcome', () => {
  test('allows dispatch for a brand-new provider (defaults to closed)', async () => {
    await expect(canDispatch('A')).resolves.toBe(true);
  });

  test('rejects an unknown providerId', async () => {
    await expect(canDispatch('Z')).rejects.toThrow();
  });

  test('opens after failureThreshold consecutive failures and blocks further dispatch', async () => {
    const config = { failureThreshold: 3, resetTimeoutMs: 10000 };
    await reportOutcome('A', 'error', config);
    await reportOutcome('A', 'error', config);
    expect(await canDispatch('A')).toBe(true);

    await reportOutcome('A', 'error', config);
    expect(await canDispatch('A')).toBe(false);

    const doc = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(doc.state).toBe('open');
    expect(doc.consecutiveFailures).toBe(3);
  });

  test('a success resets consecutiveFailures and keeps the breaker closed', async () => {
    const config = { failureThreshold: 3, resetTimeoutMs: 10000 };
    await reportOutcome('A', 'error', config);
    await reportOutcome('A', 'error', config);
    await reportOutcome('A', 'success', config);

    const doc = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(doc.state).toBe('closed');
    expect(doc.consecutiveFailures).toBe(0);
    expect(await canDispatch('A')).toBe(true);
  });

  test('transitions open -> half_open once nextRetryAt has passed, then closed on a successful probe', async () => {
    const config = { failureThreshold: 1, resetTimeoutMs: 10000 };
    const openedAt = new Date('2026-01-01T00:00:00.000Z');
    await reportOutcome('A', 'error', { ...config, now: openedAt });

    let doc = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(doc.state).toBe('open');

    // Still within the reset window: stays blocked.
    const stillOpenCheck = await canDispatch('A', { now: new Date(openedAt.getTime() + 1000) });
    expect(stillOpenCheck).toBe(false);

    // Past the reset window: flips to half_open and allows the probe.
    const pastResetWindow = new Date(openedAt.getTime() + config.resetTimeoutMs + 1);
    const halfOpenCheck = await canDispatch('A', { now: pastResetWindow });
    expect(halfOpenCheck).toBe(true);

    doc = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(doc.state).toBe('half_open');

    await reportOutcome('A', 'success', { ...config, now: pastResetWindow });
    doc = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(doc.state).toBe('closed');
  });

  test('a failed probe while half_open reopens the breaker', async () => {
    const config = { failureThreshold: 1, resetTimeoutMs: 10000 };
    const openedAt = new Date('2026-01-01T00:00:00.000Z');
    await reportOutcome('A', 'error', { ...config, now: openedAt });

    const pastResetWindow = new Date(openedAt.getTime() + config.resetTimeoutMs + 1);
    await canDispatch('A', { now: pastResetWindow }); // flips to half_open

    await reportOutcome('A', 'error', { ...config, now: pastResetWindow });
    const doc = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(doc.state).toBe('open');
  });

  test('breaker state is independent per provider', async () => {
    const config = { failureThreshold: 1, resetTimeoutMs: 10000 };
    await reportOutcome('A', 'error', config);
    expect(await canDispatch('A')).toBe(false);
    expect(await canDispatch('B')).toBe(true);
  });
});
