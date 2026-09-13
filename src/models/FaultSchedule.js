const mongoose = require('mongoose');
const { PROVIDERS, FAULT_TYPES } = require('../config/constants');

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

const FaultScheduleSchema = new mongoose.Schema(
  {
    scheduleId: { type: String, required: true, unique: true },
    events: { type: [FaultEventSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FaultSchedule', FaultScheduleSchema);
