const FaultSchedule = require('../models/FaultSchedule');

const DEFAULT_SCHEDULE_ID = 'chapter4-default-v1';

// A fixed, deterministic sequence of fault windows across the 10,000-transaction
// stream (Section 6). Not specified verbatim in Chapter 3 — designed here to
// exercise all 4 fault types against all 3 providers, staggered with clean
// recovery gaps between windows. Stored once and replayed identically for
// every strategy (see ensureFaultScheduleExists below).
function buildDefaultFaultScheduleEvents() {
  return [
    {
      providerId: 'B',
      faultType: 'degraded_latency',
      startTransactionIndex: 1000,
      endTransactionIndex: 1500,
      params: { latencyMs: 2500, rampRequests: 100 },
    },
    {
      providerId: 'C',
      faultType: 'elevated_error_rate',
      startTransactionIndex: 2000,
      endTransactionIndex: 2400,
      params: { errorRate: 0.6 },
    },
    {
      providerId: 'A',
      faultType: 'intermittent_timeout',
      startTransactionIndex: 3500,
      endTransactionIndex: 3900,
      params: { timeoutRate: 0.5 },
    },
    {
      providerId: 'B',
      faultType: 'full_outage',
      startTransactionIndex: 5000,
      endTransactionIndex: 5300,
      params: {},
    },
    {
      providerId: 'C',
      faultType: 'degraded_latency',
      startTransactionIndex: 6500,
      endTransactionIndex: 7000,
      params: { latencyMs: 2000 },
    },
    {
      providerId: 'A',
      faultType: 'elevated_error_rate',
      startTransactionIndex: 8000,
      endTransactionIndex: 8300,
      params: { errorRate: 0.8 },
    },
    {
      providerId: 'B',
      faultType: 'intermittent_timeout',
      startTransactionIndex: 9000,
      endTransactionIndex: 9200,
      params: { timeoutRate: 0.7 },
    },
  ];
}

// Idempotent "create once, read forever after" — the FIRST run (of any of
// the 40) to call this with a given scheduleId persists it; every call after
// that, across all 4 strategies x 10 repetitions, reads back that same
// stored document rather than regenerating it. That's what actually makes
// the schedule a controlled variable instead of just "deterministic code
// that happens to produce the same thing each time."
async function ensureFaultScheduleExists(scheduleId = DEFAULT_SCHEDULE_ID) {
  const existing = await FaultSchedule.findOne({ scheduleId });
  if (existing) return existing;
  return FaultSchedule.create({ scheduleId, events: buildDefaultFaultScheduleEvents() });
}

module.exports = { DEFAULT_SCHEDULE_ID, buildDefaultFaultScheduleEvents, ensureFaultScheduleExists };
