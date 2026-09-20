const mongoose = require('mongoose');
const { PROVIDERS, ROUTING_STRATEGIES, ATTEMPT_OUTCOMES, FINAL_OUTCOMES } = require('../config/constants');

// One dispatch attempt to one provider. A single transaction can have up to
// MAX_DISPATCH_ATTEMPTS of these (cascading-failover / adaptive-health-scored
// retry across providers; the other two strategies only ever produce one).
// If outcome is 'error' due to a circuit-breaker short-circuit (the provider
// was never actually contacted), latencyMs is 0 — see
// api/transactionProcessor.js for where that mapping happens.
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

// The actual experimental record — one document per simulated transaction,
// written once at the end of api/transactionProcessor.js's processTransaction().
// This is what KAN-54's metrics/statistics script reads: group by
// {runId, strategy} to get one strategy's 10 run-level values per metric,
// then compare adaptive's 10 values against each baseline's 10 (Section 10).
// Unlike ProviderHealth/CircuitBreakerState, this collection is NEVER reset
// between runs — it accumulates across all 40 runs, since it's the whole
// point of running them.
const TransactionLogSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true }, // e.g. "adaptive-health-scored-run-7"
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
