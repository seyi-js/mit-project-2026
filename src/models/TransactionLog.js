const mongoose = require('mongoose');
const { PROVIDERS, ROUTING_STRATEGIES, ATTEMPT_OUTCOMES, FINAL_OUTCOMES } = require('../config/constants');

const AttemptSchema = new mongoose.Schema(
  {
    attemptNumber: { type: Number, required: true },
    providerId: { type: String, enum: PROVIDERS, required: true },
    dispatchedAt: { type: Date, required: true },
    respondedAt: { type: Date, default: null },
    latencyMs: { type: Number, default: null },
    outcome: { type: String, enum: ATTEMPT_OUTCOMES, required: true },
  },
  { _id: false }
);

const TransactionLogSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },
    strategy: { type: String, enum: ROUTING_STRATEGIES, required: true },
    transactionIndex: { type: Number, required: true }, // position within the 10,000-transaction stream
    attempts: { type: [AttemptSchema], default: [] },
    finalOutcome: { type: String, enum: FINAL_OUTCOMES, required: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

TransactionLogSchema.index({ runId: 1, transactionIndex: 1 });

module.exports = mongoose.model('TransactionLog', TransactionLogSchema);
