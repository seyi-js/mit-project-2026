const RoutingConfig = require('../models/RoutingConfig');

// Not specified in Chapter 3 — an implementation default for the static
// rule-based baseline's fixed traffic split.
const DEFAULT_WEIGHTS = { A: 0.5, B: 0.3, C: 0.2 };

// Same "create once, read forever after" pattern as
// experiment/faultSchedule.js's ensureFaultScheduleExists. Only called by
// experimentRunner.js, and only when the active strategy is
// static-rule-based — without this, that strategy throws
// "RoutingConfig weights are not set" the first time it tries to dispatch
// (a real bug this fixed after it surfaced mid-smoke-test).
async function ensureRoutingConfigExists(weights = DEFAULT_WEIGHTS) {
  const existing = await RoutingConfig.findOne({ key: 'static-rule-based-weights' });
  if (existing) return existing;
  return RoutingConfig.create({ weights });
}

module.exports = { DEFAULT_WEIGHTS, ensureRoutingConfigExists };
