// Regenerates the Chapter 4 evidence pack: analysis/evidence/evidence-pack.md
//
// Every exhibit in that document is captured by running the real system, not
// transcribed by hand. This script starts the provider simulators and the
// orchestration service, drives them over HTTP exactly as an external client
// would, and records the actual requests and responses.
//
// It writes to an ISOLATED database (apo-evidence), which it drops first, so
// that the 400,000-transaction experimental dataset is never touched. The two
// exhibits that DO come from the experimental database are read-only queries.
//
// Usage: npm run evidence
require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const EVIDENCE_URI = 'mongodb://127.0.0.1:27017/apo-evidence';
const EXPERIMENT_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/adaptive-payment-orchestration';
const API = 'http://127.0.0.1:3000';
const PROV = 'http://127.0.0.1:4000';
const OUT_DIR = path.join(__dirname, '..', '..', 'analysis', 'evidence');

const exhibits = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function exhibit(id, title, proves, body) {
  exhibits.push({ id, title, proves, body });
  console.log(`  Exhibit ${id}: ${title}`);
}

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  const shown = body ? ` \\\n       -d '${JSON.stringify(body)}'` : '';
  return {
    request: `$ curl -s -X ${method} ${url}${shown}`,
    response: JSON.stringify(json, null, 2),
    json,
  };
}

function block(...parts) {
  return parts.filter(Boolean).join('\n');
}

async function waitForServers() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const a = await fetch(`${API}/health`);
      const b = await fetch(`${PROV}/providers/A/fault`);
      if (a.ok && b.ok) return;
    } catch (_) { /* not up yet */ }
    await sleep(400);
  }
  throw new Error('servers did not become ready');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // --- isolated database ----------------------------------------------------
  await mongoose.connect(EVIDENCE_URI);
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();

  const env = { ...process.env, MONGODB_URI: EVIDENCE_URI };
  const providers = spawn('node', ['src/providers/server.js'], { env, stdio: 'ignore' });
  const app = spawn('node', ['src/server.js'], { env, stdio: 'ignore' });
  const shutdown = () => { providers.kill(); app.kill(); };
  process.on('exit', shutdown);

  try {
    await waitForServers();

    // --- A: service is live -------------------------------------------------
    const health = await call('GET', `${API}/health`);
    exhibit('A', 'The orchestration service is running',
      'Working web/API prototype',
      block(health.request, '', health.response));

    // --- B: strategy control ------------------------------------------------
    const before = await call('GET', `${API}/strategy`);
    const set = await call('PUT', `${API}/strategy`, { strategy: 'adaptive-health-scored' });
    const after = await call('GET', `${API}/strategy`);
    exhibit('B', 'The active routing strategy is selectable at runtime',
      'API endpoints; the strategy is the only variable across the four experimental conditions',
      block(before.request, before.response, '', set.request, set.response, '', after.request, after.response));

    // --- C: a payment, all providers healthy --------------------------------
    const happy = await call('POST', `${API}/transactions`, { runId: 'evidence', transactionIndex: 1 });
    exhibit('C', 'A payment request is accepted and orchestrated',
      'API endpoints for payment requests',
      block(happy.request, '', happy.response));

    // warm all three providers to a healthy score
    for (let i = 2; i <= 21; i += 1) {
      await call('POST', `${API}/transactions`, { runId: 'evidence', transactionIndex: i });
    }

    // --- D: fault injection -------------------------------------------------
    const faultBefore = await call('GET', `${PROV}/providers/A/fault`);
    const faultSet = await call('PUT', `${PROV}/providers/A/fault`, {
      faultType: 'elevated_error_rate',
      params: { errorRate: 1.0 },
    });
    exhibit('D', 'A fault is injected into Provider A at runtime',
      'Provider simulation services; fault-injection evidence',
      block(faultBefore.request, faultBefore.response, '', faultSet.request, faultSet.response));

    // --- E: failover --------------------------------------------------------
    let failover = null;
    for (let i = 22; i <= 120 && !failover; i += 1) {
      const r = await call('POST', `${API}/transactions`, { runId: 'evidence', transactionIndex: i });
      if (r.json && r.json.attempts.length > 1) failover = r;
    }
    exhibit('E', 'A failed dispatch is retried on a different provider',
      'Routing decision logs; retry/failover implementation',
      block(failover.request, '', failover.response));

    // --- F: the health score responded --------------------------------------
    await mongoose.connect(EVIDENCE_URI);
    const healths = await mongoose.connection.db.collection('providerhealths')
      .find({}).sort({ providerId: 1 }).toArray();
    exhibit('F', 'The Analyser lowered the faulted provider’s HealthScore',
      'MongoDB containing provider health information',
      healths.map((p) => `  Provider ${p.providerId}: healthScore=${p.healthScore.toFixed(6)}  observations=${p.recentObservations.length}`).join('\n'));
    await mongoose.disconnect();

    // --- G: circuit breaker -------------------------------------------------
    await call('PUT', `${API}/strategy`, { strategy: 'single-provider' });
    const cbLines = ['(strategy switched to single-provider, so every request targets the faulted Provider A)', ''];
    for (let i = 100; i <= 106; i += 1) {
      const r = await call('POST', `${API}/transactions`, { runId: 'evidence', transactionIndex: i });
      const a = r.json.attempts[0];
      cbLines.push(`  tx ${i}: provider=${a.providerId} outcome=${a.outcome} latencyMs=${a.latencyMs} final=${r.json.finalOutcome}`);
    }
    await mongoose.connect(EVIDENCE_URI);
    const breakers = await mongoose.connection.db.collection('circuitbreakerstates')
      .find({}).sort({ providerId: 1 }).toArray();
    cbLines.push('', '  --- CircuitBreakerState collection ---');
    for (const c of breakers) {
      cbLines.push(`  Provider ${c.providerId}: state=${c.state} consecutiveFailures=${c.consecutiveFailures} blockedAttempts=${c.blockedAttempts ?? 0}`);
    }
    await mongoose.disconnect();
    exhibit('G', 'The circuit breaker opens after five consecutive failures',
      'Circuit-breaker implementation. Note that short-circuited attempts report latencyMs=0, which is the signature the analysis pipeline uses to exclude non-observations from the health score.',
      cbLines.join('\n'));

    // --- H: idempotency -----------------------------------------------------
    await call('DELETE', `${PROV}/providers/A/fault`);
    await call('PUT', `${API}/strategy`, { strategy: 'cascading-failover' });
    const first = await call('POST', `${API}/transactions`, { runId: 'evidence', transactionIndex: 200, transactionId: 'PAY-2026-0001' });
    const dup = await call('POST', `${API}/transactions`, { runId: 'evidence', transactionIndex: 201, transactionId: 'PAY-2026-0001' });
    await mongoose.connect(EVIDENCE_URI);
    const written = await mongoose.connection.db.collection('transactionlogs')
      .countDocuments({ transactionIndex: { $in: [200, 201] } });
    await mongoose.disconnect();
    exhibit('H', 'A resubmitted transaction is not processed twice',
      'Idempotency mechanism',
      block(
        '# first submission', first.request, first.response, '',
        '# duplicate submission, declaring transactionIndex 201', dup.request, dup.response, '',
        `  first  transactionLogId: ${first.json.transactionLogId}`,
        `  second transactionLogId: ${dup.json.transactionLogId}`,
        `  identical: ${first.json.transactionLogId === dup.json.transactionLogId}`,
        `  the duplicate returned transactionIndex ${dup.json.transactionIndex}, not 201 - the retry sequence never re-executed`,
        `  TransactionLog documents written for both submissions: ${written}`
      ));
  } finally {
    shutdown();
  }

  // --- I and J: read-only, from the real experimental database ---------------
  await mongoose.connect(EXPERIMENT_URI);
  const db = mongoose.connection.db;
  const counts = [];
  for (const c of ['transactionlogs', 'providerhealths', 'circuitbreakerstates', 'routingconfigs', 'faultschedules']) {
    counts.push(`  ${c.padEnd(22)} documents: ${await db.collection(c).countDocuments()}`);
  }
  counts.push(`  distinct experimental runs: ${(await db.collection('transactionlogs').distinct('runId')).length}`);
  exhibit('I', 'The experimental dataset as stored',
    'MongoDB/database contents; scale of the evaluation',
    counts.join('\n'));

  const real = await db.collection('transactionlogs').findOne({
    runId: 'adaptive-health-scored-run-1',
    transactionIndex: { $gte: 3500, $lt: 3900 },
    'attempts.1': { $exists: true },
  });
  exhibit('J', 'A real logged transaction from the experiment',
    'Routing decision logs, retry/failover and fault injection, in one record from the reported dataset',
    block('  (inside fault window E3: Provider A under intermittent timeout, transactions 3500-3900)', '',
      JSON.stringify(real, null, 2)));
  await mongoose.disconnect();

  // --- write the pack -------------------------------------------------------
  const now = new Date().toISOString().slice(0, 10);
  const md = [
    '# Chapter 4 — Evidence Pack',
    '',
    `Generated ${now} by \`npm run evidence\`.`,
    '',
    'Every exhibit below was captured by running the prototype, not transcribed by hand.',
    'Exhibits A–H were produced live against an isolated database (`apo-evidence`), which the',
    'script drops and rebuilds on each execution, so the experimental dataset is never modified.',
    'Exhibits I and J are read-only queries against the experimental database that Chapter 4 reports.',
    '',
    '---',
    '',
    ...exhibits.flatMap((e) => [
      `## Exhibit ${e.id} — ${e.title}`,
      '',
      `**Evidences:** ${e.proves}`,
      '',
      '```',
      e.body,
      '```',
      '',
    ]),
  ].join('\n');

  fs.writeFileSync(path.join(OUT_DIR, 'evidence-pack.md'), md);
  console.log(`\nWrote ${path.join(OUT_DIR, 'evidence-pack.md')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
