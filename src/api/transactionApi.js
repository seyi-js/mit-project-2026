const express = require('express');
const { createPlanner } = require('../planner/planner');
const { processTransaction } = require('./transactionProcessor');
const { ROUTING_STRATEGIES } = require('../config/constants');

// The "Transaction API" component (Section 2): the live HTTP entry point.
// Existing separately from experiment/experimentRunner.js — that one calls
// processTransaction() directly, in-process, for batch experiment runs; this
// file is for driving the same pipeline over real HTTP, e.g. manual testing.
function createTransactionApi({ baseUrl, timeoutMs } = {}) {
  const router = express.Router();
  // Deliberately closure-scoped per createTransactionApi() call, NOT a
  // module-level singleton — so multiple app instances (e.g. one per test)
  // never leak their active strategy into each other.
  let activeStrategy = null;
  let activeStrategyName = null;

  router.get('/strategy', (req, res) => {
    res.json({ strategy: activeStrategyName });
  });

  // Runtime strategy switch (Section 9 step 1: "initialise the service with
  // that strategy active") — mirrors the provider simulators' own runtime
  // fault-reconfiguration pattern (PUT /providers/:id/fault). Note
  // experiment/experimentRunner.js does NOT call this endpoint — it builds
  // its own strategy instance directly via createPlanner() and calls
  // processTransaction() in-process; this endpoint exists for driving the
  // same pipeline over real HTTP instead (manual testing, or a future
  // caller that isn't this codebase).
  router.put('/strategy', (req, res) => {
    const { strategy, options } = req.body || {};
    if (!ROUTING_STRATEGIES.includes(strategy)) {
      return res.status(400).json({ error: `Unknown strategy: ${strategy}` });
    }
    activeStrategy = createPlanner(strategy, options);
    activeStrategyName = strategy;
    res.json({ strategy });
  });

  // "Receives incoming payment requests... returns the final orchestration
  // outcome" (Section 2). All the actual work — Planner, Executor, Monitor,
  // Analyser, retries — happens inside processTransaction(); this handler is
  // just the HTTP wrapper around it.
  router.post('/transactions', async (req, res, next) => {
    if (!activeStrategy) {
      return res.status(400).json({ error: 'No active routing strategy set. PUT /strategy first.' });
    }

    try {
      const { runId, transactionIndex, transactionId } = req.body || {};
      const result = await processTransaction({
        strategy: activeStrategy,
        strategyName: activeStrategyName,
        runId,
        transactionIndex,
        transactionId,
        baseUrl,
        timeoutMs,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createTransactionApi };
