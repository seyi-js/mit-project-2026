// Live demonstration server.
//
// DELIBERATELY SEPARATE from the orchestration service. It does not import the
// pipeline, the Planner, the Executor or any module whose behaviour Chapter 4
// measures. It drives the real service over HTTP exactly as any external client
// would, and reads the Knowledge Store directly for display. Nothing here can
// alter the code path the experiment evaluated.
//
// It runs against its own database (apo-demo), so a demonstration never touches
// the experimental dataset.
require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const { PROVIDERS, ROUTING_STRATEGIES, FAULT_TYPES } = require('../config/constants');
const ProviderHealth = require('../models/ProviderHealth');
const CircuitBreakerState = require('../models/CircuitBreakerState');
const TransactionLog = require('../models/TransactionLog');

const PORT = process.env.PORT || process.env.DEMO_PORT || 5050;
const API = process.env.DEMO_API_URL || 'http://127.0.0.1:3000';
const PROV = process.env.DEMO_PROVIDERS_URL || 'http://127.0.0.1:4000';

// Rolling display state. Kept in memory: this is a view, not a record.
const feed = [];           // most recent transactions, newest first
const FEED_LIMIT = 14;
const history = Object.fromEntries(PROVIDERS.map((p) => [p, []])); // health sparklines
const HISTORY_LIMIT = 120;
let counters = { total: 0, firstAttemptSuccess: 0, retried: 0, failed: 0 };
const routingWindow = [];  // first-attempt provider over the last N transactions
const ROUTING_WINDOW = 60;
let load = { running: false, timer: null, ratePerSecond: 6, index: 0 };
let lastError = null;   // surfaced on the dashboard: a silent failure once hid a real bug

async function submitTransaction() {
  try {
    const res = await fetch(`${API}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'demo', transactionIndex: load.index += 1 }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      lastError = body.error || `Transaction rejected (HTTP ${res.status})`;
      return;
    }
    lastError = null;
    const tx = await res.json();

    counters.total += 1;
    if (tx.attempts.length > 0 && tx.attempts[0].outcome === 'success') counters.firstAttemptSuccess += 1;
    if (tx.attempts.length > 1) counters.retried += 1;
    if (tx.finalOutcome !== 'success') counters.failed += 1;

    if (tx.attempts.length > 0) {
      routingWindow.unshift(tx.attempts[0].providerId);
      if (routingWindow.length > ROUTING_WINDOW) routingWindow.length = ROUTING_WINDOW;
    }

    feed.unshift({
      index: tx.transactionIndex,
      finalOutcome: tx.finalOutcome,
      attempts: tx.attempts.map((a) => ({
        providerId: a.providerId,
        outcome: a.outcome,
        latencyMs: a.latencyMs,
      })),
    });
    if (feed.length > FEED_LIMIT) feed.length = FEED_LIMIT;
  } catch (err) {
    lastError = `Cannot reach the orchestration service: ${err.message}`;
  }
}

function startLoad() {
  if (load.running) return;
  load.running = true;
  load.timer = setInterval(submitTransaction, Math.round(1000 / load.ratePerSecond));
}

function stopLoad() {
  load.running = false;
  clearInterval(load.timer);
  load.timer = null;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // --- state for the dashboard ---------------------------------------------
  app.get('/api/state', async (req, res) => {
    const [healths, breakers, strategyRes] = await Promise.all([
      ProviderHealth.find({}).lean(),
      CircuitBreakerState.find({}).lean(),
      fetch(`${API}/strategy`).then((r) => r.json()).catch(() => ({ strategy: null })),
    ]);

    const faults = {};
    await Promise.all(PROVIDERS.map(async (p) => {
      try {
        faults[p] = await fetch(`${PROV}/providers/${p}/fault`).then((r) => r.json());
      } catch (_) { faults[p] = { faultType: null }; }
    }));

    const providers = PROVIDERS.map((id) => {
      const h = healths.find((x) => x.providerId === id);
      const b = breakers.find((x) => x.providerId === id);
      const score = h ? h.healthScore : null;
      if (score !== null) {
        history[id].push(score);
        if (history[id].length > HISTORY_LIMIT) history[id].shift();
      }
      return {
        id,
        healthScore: score,
        observations: h ? h.recentObservations.length : 0,
        breaker: b ? b.state : 'closed',
        consecutiveFailures: b ? b.consecutiveFailures : 0,
        fault: faults[id] && faults[id].faultType ? faults[id] : null,
        history: history[id],
      };
    });

    res.json({
      providers,
      strategy: strategyRes.strategy,
      strategies: ROUTING_STRATEGIES,
      faultTypes: FAULT_TYPES,
      feed,
      counters,
      routing: Object.fromEntries(
        PROVIDERS.map((p) => [p, routingWindow.filter((x) => x === p).length])
      ),
      routingWindowSize: routingWindow.length,
      load: { running: load.running, ratePerSecond: load.ratePerSecond },
      error: lastError,
    });
  });

  // --- controls -------------------------------------------------------------
  app.put('/api/strategy', async (req, res) => {
    const r = await fetch(`${API}/strategy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: req.body.strategy }),
    });
    res.status(r.status).json(await r.json());
  });

  app.put('/api/fault/:providerId', async (req, res) => {
    const { providerId } = req.params;
    const { faultType, params } = req.body || {};
    const url = `${PROV}/providers/${providerId}/fault`;
    const r = faultType
      ? await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ faultType, params: params || {} }),
        })
      : await fetch(url, { method: 'DELETE' });
    res.status(r.status).json(await r.json());
  });

  app.post('/api/load', (req, res) => {
    if (req.body.running) startLoad(); else stopLoad();
    res.json({ running: load.running });
  });

  app.post('/api/reset', async (req, res) => {
    stopLoad();
    lastError = null;
    await Promise.all([
      ProviderHealth.deleteMany({}),
      CircuitBreakerState.deleteMany({}),
      TransactionLog.deleteMany({}),   // reset means reset: the demo log too
      ...PROVIDERS.map((p) => fetch(`${PROV}/providers/${p}/fault`, { method: 'DELETE' }).catch(() => null)),
    ]);
    feed.length = 0;
    counters = { total: 0, firstAttemptSuccess: 0, retried: 0, failed: 0 };
    PROVIDERS.forEach((p) => { history[p].length = 0; });
    routingWindow.length = 0;
    load.index = 0;
    res.json({ ok: true });
  });

  return app;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  createApp().listen(PORT, () => {
    console.log(`Demo dashboard:  http://127.0.0.1:${PORT}`);
  });
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { createApp };
