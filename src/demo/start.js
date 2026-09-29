// One command to bring up a demonstration: `npm run demo`.
//
// Starts the provider simulators, the orchestration service and the demo
// dashboard, all pointed at an isolated database (apo-demo) so that a
// demonstration can never modify the experimental dataset. Sets an initial
// routing strategy so the dashboard opens in a working state rather than empty.
require('dotenv').config();
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { ensureRoutingConfigExists } = require('../experiment/routingConfig');

// On a hosting platform only one port is publicly routed, and it arrives as
// PORT. The dashboard takes it; the orchestration service and the provider
// simulators are bound to fixed loopback ports that are never exposed.
const PUBLIC_PORT = process.env.PORT || process.env.DEMO_PORT || 5050;
const INTERNAL_API_PORT = 3000;
const INTERNAL_PROVIDERS_PORT = 4000;

// The demonstration database is chosen deliberately, never inherited by
// accident: an explicit DEMO_MONGODB_URI wins; a MONGODB_URI is only accepted
// if it actually names a demo database; otherwise a local default is used. The
// name guard in main() is the backstop, since this script drops the database.
function pickDemoUri() {
  if (process.env.DEMO_MONGODB_URI) return process.env.DEMO_MONGODB_URI;
  if (process.env.MONGODB_URI && /demo/i.test(process.env.MONGODB_URI)) return process.env.MONGODB_URI;
  return 'mongodb://127.0.0.1:27017/apo-demo';
}
const DEMO_URI = pickDemoUri();
const API = `http://127.0.0.1:${INTERNAL_API_PORT}`;
const DASHBOARD = `http://127.0.0.1:${PUBLIC_PORT}`;

const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(name, script, env) {
  const child = spawn('node', [script], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  child.on('exit', (code) => {
    if (code !== null && code !== 0) console.error(`${name} exited with code ${code}`);
  });
  children.push(child);
  return child;
}

function shutdown() {
  children.forEach((c) => c.kill());
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function waitFor(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try { if ((await fetch(url)).ok) return true; } catch (_) { /* not up yet */ }
    await sleep(350);
  }
  return false;
}

async function main() {
  console.log('Starting demonstration environment...');
  console.log(`  database: ${DEMO_URI}  (isolated - the experimental dataset is untouched)`);

  // A demonstration starts from a clean slate every time. The name guard is a
  // hard stop: this script drops a database, and must never be able to drop the
  // one holding the experimental dataset, however the URI is configured.
  await mongoose.connect(DEMO_URI);
  const dbName = mongoose.connection.db.databaseName;
  if (!/demo/i.test(dbName)) {
    console.error(`Refusing to reset database "${dbName}": the demo database name must contain "demo".`);
    await mongoose.disconnect();
    return shutdown();
  }
  await mongoose.connection.db.dropDatabase();

  // The static rule-based strategy reads its fixed traffic split from the
  // RoutingConfig collection and throws without it. The experiment seeds this
  // in experimentRunner; a demonstration must too, and via the same function so
  // the split shown here is the 50/30/20 recorded in Section 4.2.6.
  await ensureRoutingConfigExists();

  await mongoose.disconnect();

  const env = {
    ...process.env,
    MONGODB_URI: DEMO_URI,
    PORT: String(INTERNAL_API_PORT),
    PROVIDERS_PORT: String(INTERNAL_PROVIDERS_PORT),
  };
  start('providers', 'src/providers/server.js', env);
  start('orchestration service', 'src/server.js', env);
  // The dashboard is the only process the outside world reaches, so it takes
  // the public port rather than the internal one the other two share.
  start('dashboard', 'src/demo/server.js', { ...env, PORT: String(PUBLIC_PORT) });

  const ok = await waitFor(`${API}/health`) && await waitFor(`${DASHBOARD}/api/state`);
  if (!ok) {
    console.error('Services did not start. Is MongoDB running on 127.0.0.1:27017?');
    return shutdown();
  }

  await fetch(`${API}/strategy`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy: 'adaptive-health-scored' }),
  });

  console.log('');
  console.log(`  Dashboard listening on port ${PUBLIC_PORT}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
}

main().catch((err) => { console.error(err); shutdown(); });
