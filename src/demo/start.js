// One command to bring up a demonstration: `npm run demo`.
//
// Starts the provider simulators, the orchestration service and the demo
// dashboard, all pointed at an isolated database (apo-demo) so that a
// demonstration can never modify the experimental dataset. Sets an initial
// routing strategy so the dashboard opens in a working state rather than empty.
require('dotenv').config();
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const DEMO_URI = process.env.DEMO_MONGODB_URI || 'mongodb://127.0.0.1:27017/apo-demo';
const API = 'http://127.0.0.1:3000';
const DASHBOARD = `http://127.0.0.1:${process.env.DEMO_PORT || 5050}`;

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

  // A demonstration starts from a clean slate every time.
  await mongoose.connect(DEMO_URI);
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();

  const env = { ...process.env, MONGODB_URI: DEMO_URI };
  start('providers', 'src/providers/server.js', env);
  start('orchestration service', 'src/server.js', env);
  start('dashboard', 'src/demo/server.js', env);

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
  console.log(`  Dashboard:  ${DASHBOARD}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
}

main().catch((err) => { console.error(err); shutdown(); });
