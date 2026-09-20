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
    const config = { failureThreshold: 3 };
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
    const config = { failureThreshold: 3 };
    await reportOutcome('A', 'error', config);
    await reportOutcome('A', 'error', config);
    await reportOutcome('A', 'success', config);

    const doc = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(doc.state).toBe('closed');
    expect(doc.consecutiveFailures).toBe(0);
    expect(await canDispatch('A')).toBe(true);
  });

  test('transitions open -> half_open after resetAfterAttempts blocked calls, regardless of real time, then closed on a successful probe', async () => {
    await reportOutcome('A', 'error', { failureThreshold: 1 });

    let doc = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(doc.state).toBe('open');

    // Still under the blocked-attempt threshold: stays blocked.
    expect(await canDispatch('A', { resetAfterAttempts: 3 })).toBe(false);
    expect(await canDispatch('A', { resetAfterAttempts: 3 })).toBe(false);

    // The 3rd blocked call reaches the threshold and becomes the probe.
    expect(await canDispatch('A', { resetAfterAttempts: 3 })).toBe(true);

    doc = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(doc.state).toBe('half_open');
    expect(doc.blockedAttempts).toBe(0);

    await reportOutcome('A', 'success', { failureThreshold: 1 });
    doc = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(doc.state).toBe('closed');
  });

  test('recovery does not depend on elapsed wall-clock time — many blocked calls in immediate succession still recover', async () => {
    // This is the exact scenario that broke the old wall-clock design: all
    // of these calls happen synchronously, effectively 0ms apart.
    await reportOutcome('A', 'error', { failureThreshold: 1 });

    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await canDispatch('A', { resetAfterAttempts: 5 });
    }
    // 5th blocked call flips it to half_open.
    expect(await canDispatch('A', { resetAfterAttempts: 5 })).toBe(true);
  });

  test('a failed probe while half_open reopens the breaker', async () => {
    await reportOutcome('A', 'error', { failureThreshold: 1 });
    await canDispatch('A', { resetAfterAttempts: 1 }); // flips to half_open

    await reportOutcome('A', 'error', { failureThreshold: 1 });
    const doc = await CircuitBreakerState.findOne({ providerId: 'A' });
    expect(doc.state).toBe('open');
  });

  test('breaker state is independent per provider', async () => {
    await reportOutcome('A', 'error', { failureThreshold: 1 });
    expect(await canDispatch('A')).toBe(false);
    expect(await canDispatch('B')).toBe(true);
  });
});
