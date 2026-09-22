// Computes the 6 dependent variables from Section 7, per experimental run,
// from the logged TransactionLog documents.
//
// Deliberately written in Node rather than the Python analysis script so
// that adaptation latency and recovery time are derived using the EXACT
// same HealthScore formulas the live system used (analyser/healthScore.js).
// Re-implementing the EWMA in Python would risk silently diverging from what
// actually ran, which would invalidate those two metrics.
const { computeObservedValue, blendHealthScore } = require('../analyser/healthScore');
const { deriveIndicators } = require('../monitor/monitor');
const { PROVIDERS, NEUTRAL_HEALTH_SCORE, DEGRADATION_THRESHOLD_DEFAULT } = require('../config/constants');

// A circuit-breaker short-circuit was logged as outcome 'error' with an
// explicitly-set latencyMs of 0 (see api/transactionProcessor.js), and the
// live system skipped Monitor/Analyser for those — so the reconstruction
// below must skip them too, or the HealthScore trajectory won't match what
// actually happened.
//
// LIMITATION: a genuine decline that completed in under 1ms would also
// record 0ms and be misread as a short-circuit. Measured against the logged
// data this affects well under 1 attempt per 10,000, so its effect on the
// reconstructed trajectory is negligible — but it is an inference, not a
// recorded fact. A future run should log an explicit circuitOpen flag.
function isCircuitOpenAttempt(attempt) {
  return attempt.outcome === 'error' && attempt.latencyMs === 0;
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Replays every logged attempt through the real scoring formulas to recover
// each provider's HealthScore over the course of the run. Returns, per
// provider, the ordered sequence of scores after each update — which is what
// the adaptation-latency and recovery-time definitions need, since both are
// counted in "transactions dispatched to that provider".
function reconstructHealthTimeline(logs, weights = undefined) {
  const healthScore = {};
  const timeline = {};
  for (const providerId of PROVIDERS) {
    healthScore[providerId] = NEUTRAL_HEALTH_SCORE;
    timeline[providerId] = [];
  }

  for (const log of logs) {
    for (const attempt of log.attempts) {
      if (isCircuitOpenAttempt(attempt)) continue;

      const { errorIndicator, timeoutIndicator } = deriveIndicators(attempt.outcome);
      // `weights` is only passed by the sensitivity analysis. Note that
      // re-scoring logged attempts with different weights shows how the
      // MEASURED metrics would change; it cannot show how different weights
      // would have changed the routing decisions that actually happened.
      const observedValue = computeObservedValue(
        {
          latencyMs: attempt.latencyMs,
          errorIndicator,
          timeoutIndicator,
        },
        weights
      );
      healthScore[attempt.providerId] = blendHealthScore(observedValue, healthScore[attempt.providerId]);
      timeline[attempt.providerId].push({
        transactionIndex: log.transactionIndex,
        healthScore: healthScore[attempt.providerId],
      });
    }
  }

  return timeline;
}

// Section 7: "counted from the START of an injected fault against that
// provider, until the first subsequent transaction where that provider's
// HealthScore drops below the degradation threshold".
//
// Bounded to the fault's own window: if the score never crosses below the
// threshold while the fault is actually active, the fault ended without
// being detected, which is a CENSORED observation (null) — not a larger
// number. Without this bound the search runs on past the fault into a period
// where the provider is healthy again and its score is climbing, producing a
// meaningless count that most penalises whichever strategy diverted traffic
// away fastest.
function adaptationLatency(timeline, providerId, faultStartIndex, faultEndIndex, threshold) {
  const entries = timeline[providerId].filter(
    (e) => e.transactionIndex >= faultStartIndex && e.transactionIndex < faultEndIndex
  );
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].healthScore < threshold) return i + 1;
  }
  return null;
}

// Section 7: "counted from the END of fault injection against that provider,
// until the first subsequent transaction where that provider's HealthScore
// returns to/above the degradation threshold".
//
// Returns null if the provider wasn't actually degraded when the fault ended
// — there was nothing to recover from, which is not the same as recovering
// instantly. Bounded by nextFaultStartIndex so a later fault on the same
// provider can't be mistaken for a failure to recover from this one.
function recoveryTime(timeline, providerId, faultEndIndex, nextFaultStartIndex, threshold) {
  const entries = timeline[providerId];
  const priorEntries = entries.filter((e) => e.transactionIndex < faultEndIndex);
  const scoreAtFaultEnd = priorEntries.length > 0
    ? priorEntries[priorEntries.length - 1].healthScore
    : NEUTRAL_HEALTH_SCORE;
  if (scoreAtFaultEnd >= threshold) return null;

  const after = entries.filter(
    (e) => e.transactionIndex >= faultEndIndex && e.transactionIndex < nextFaultStartIndex
  );
  for (let i = 0; i < after.length; i += 1) {
    if (after[i].healthScore >= threshold) return i + 1;
  }
  return null;
}

function computeRunMetrics(
  logs,
  faultEvents,
  { threshold = DEGRADATION_THRESHOLD_DEFAULT, weights = undefined } = {}
) {
  const ordered = [...logs].sort((a, b) => a.transactionIndex - b.transactionIndex);
  const elapsed = (l) => new Date(l.attempts[l.attempts.length - 1].respondedAt) - new Date(l.attempts[0].dispatchedAt);

  // 1. Transaction success rate
  const successes = ordered.filter((l) => l.finalOutcome === 'success').length;
  const successRate = successes / ordered.length;

  // 1b. First-attempt success rate. NOT one of Section 7's six DVs, but it is
  //     the only measure here that isolates ROUTING QUALITY from retry
  //     capability: it asks whether the Planner's first choice was correct,
  //     independent of whether a fallback later rescued the transaction.
  //     Section 7's success rate cannot distinguish "routed well" from
  //     "retried until something worked" — a strategy with no routing
  //     intelligence but three attempts scores identically to a perfect one.
  const firstAttemptSuccesses = ordered.filter(
    (l) => l.attempts.length > 0 && l.attempts[0].outcome === 'success'
  ).length;
  const firstAttemptSuccessRate = firstAttemptSuccesses / ordered.length;

  // 2. Response time: API submission -> final outcome, per transaction.
  //    Reported over all transactions (as Section 7 defines it) AND over
  //    successes only, because the two diverge sharply for strategies that
  //    fail often: a fast failure lowers the all-transaction mean, so a
  //    strategy can look faster purely by failing quickly. Comparing
  //    strategies with different success rates on the all-transaction figure
  //    alone is not like-for-like.
  const withAttempts = ordered.filter((l) => l.attempts.length > 0);
  const responseTimes = withAttempts.map(elapsed);
  const responseTimesSuccessOnly = withAttempts.filter((l) => l.finalOutcome === 'success').map(elapsed);

  // 3. Failover latency: extra time between the first failed attempt and the
  //    eventual final attempt, for transactions needing more than one.
  const failoverLatencies = ordered
    .filter((l) => l.attempts.length > 1)
    .map((l) => {
      const first = l.attempts[0];
      const last = l.attempts[l.attempts.length - 1];
      return new Date(last.respondedAt) - new Date(first.respondedAt);
    });

  // 4 & 5. Adaptation latency and recovery time, per injected fault event.
  const timeline = reconstructHealthTimeline(ordered, weights);
  const adaptationLatencies = [];
  const recoveryTimes = [];
  const lastIndex = ordered.length > 0 ? ordered[ordered.length - 1].transactionIndex + 1 : 0;

  // Kept index-aligned with faultEvents so the statistics step can restrict
  // comparisons to events BOTH strategies actually detected. Aggregating
  // straight to a mean hides that different strategies detect different
  // subsets of faults — a strategy that only ever touches one provider can
  // only detect that provider's faults — which makes the means incomparable.
  const adaptationByEvent = [];
  const recoveryByEvent = [];

  for (const event of faultEvents) {
    const adapt = adaptationLatency(
      timeline,
      event.providerId,
      event.startTransactionIndex,
      event.endTransactionIndex,
      threshold
    );
    adaptationByEvent.push(adapt);
    if (adapt !== null) adaptationLatencies.push(adapt);

    // Recovery is measured up until this provider's NEXT fault begins, so a
    // subsequent unrelated fault can't be read as a failure to recover.
    const nextFaultStart = faultEvents
      .filter((e) => e.providerId === event.providerId && e.startTransactionIndex > event.endTransactionIndex)
      .reduce((min, e) => Math.min(min, e.startTransactionIndex), lastIndex);

    const recover = recoveryTime(timeline, event.providerId, event.endTransactionIndex, nextFaultStart, threshold);
    recoveryByEvent.push(recover);
    if (recover !== null) recoveryTimes.push(recover);
  }

  return {
    transactions: ordered.length,
    successRate,
    firstAttemptSuccessRate,
    responseTimeMean: mean(responseTimes),
    responseTimeP95: percentile(responseTimes, 0.95),
    responseTimeMeanSuccessOnly: mean(responseTimesSuccessOnly),
    responseTimeP95SuccessOnly: percentile(responseTimesSuccessOnly, 0.95),
    failoverLatencyMean: mean(failoverLatencies),
    failoverLatencyCount: failoverLatencies.length,
    retriedTransactions: failoverLatencies.length,
    adaptationLatencyMean: mean(adaptationLatencies),
    adaptationLatencyCount: adaptationLatencies.length,
    adaptationByEvent,
    recoveryTimeMean: mean(recoveryTimes),
    recoveryTimeCount: recoveryTimes.length,
    recoveryByEvent,
  };
}

module.exports = {
  computeRunMetrics,
  reconstructHealthTimeline,
  adaptationLatency,
  recoveryTime,
  percentile,
  mean,
  isCircuitOpenAttempt,
};
