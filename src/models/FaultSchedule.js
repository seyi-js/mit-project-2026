const mongoose = require('mongoose');
const { PROVIDERS, FAULT_TYPES } = require('../config/constants');

// One fault window: providerId misbehaves as faultType from
// startTransactionIndex up to (exclusive) endTransactionIndex, where those
// indices are positions in the 10,000-transaction stream — NOT wall-clock
// time. `params` shape depends on faultType (e.g. { latencyMs, rampRequests }
// for degraded_latency, { errorRate } for elevated_error_rate) — see
// providers/providerSimulator.js for exactly how each is interpreted.
const FaultEventSchema = new mongoose.Schema(
  {
    providerId: { type: String, enum: PROVIDERS, required: true },
    faultType: { type: String, enum: FAULT_TYPES, required: true },
    startTransactionIndex: { type: Number, required: true },
    endTransactionIndex: { type: Number, required: true },
    params: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

// A named, fixed sequence of fault events (see experiment/faultSchedule.js
// for the actual designed schedule). Created ONCE per scheduleId and then
// read back — never regenerated — so every one of the 40 experimental runs
// faces the exact same faults at the exact same points, which is what makes
// the fault schedule a controlled variable rather than a confound.
const FaultScheduleSchema = new mongoose.Schema(
  {
    scheduleId: { type: String, required: true, unique: true },
    events: { type: [FaultEventSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FaultSchedule', FaultScheduleSchema);
