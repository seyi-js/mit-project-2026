require('dotenv').config();
const mongoose = require('mongoose');

const FaultSchedule = require('../src/models/FaultSchedule');
const {
  ensureFaultScheduleExists,
  buildDefaultFaultScheduleEvents,
  DEFAULT_SCHEDULE_ID,
} = require('../src/experiment/faultSchedule');

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
  await FaultSchedule.deleteMany({});
});

describe('ensureFaultScheduleExists', () => {
  test('creates the schedule on first call', async () => {
    const doc = await ensureFaultScheduleExists('test-schedule-1');
    expect(doc.scheduleId).toBe('test-schedule-1');
    expect(doc.events.length).toBeGreaterThan(0);
  });

  test('the default schedule exercises all 4 fault types and all 3 providers', () => {
    const events = buildDefaultFaultScheduleEvents();
    const faultTypes = new Set(events.map((e) => e.faultType));
    const providerIds = new Set(events.map((e) => e.providerId));
    expect(faultTypes).toEqual(new Set(['degraded_latency', 'elevated_error_rate', 'intermittent_timeout', 'full_outage']));
    expect(providerIds).toEqual(new Set(['A', 'B', 'C']));
  });

  test('returns the same stored document on a second call rather than regenerating', async () => {
    const first = await ensureFaultScheduleExists(DEFAULT_SCHEDULE_ID);
    await FaultSchedule.updateOne({ scheduleId: DEFAULT_SCHEDULE_ID }, { $set: { 'events.0.params.latencyMs': 9999 } });

    const second = await ensureFaultScheduleExists(DEFAULT_SCHEDULE_ID);
    expect(second.events[0].params.latencyMs).toBe(9999);
    expect(second._id.toString()).toBe(first._id.toString());

    const count = await FaultSchedule.countDocuments({ scheduleId: DEFAULT_SCHEDULE_ID });
    expect(count).toBe(1);
  });
});
