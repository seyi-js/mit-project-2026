const express = require('express');
const { PROVIDERS } = require('../config/constants');
const { createProviderSimulator } = require('./providerSimulator');

// Bundles the 3 provider simulators into one Express app, each mounted at
// its own path (/providers/A, /providers/B, /providers/C) with independent
// in-memory fault state. Runs as its OWN process on PROVIDERS_PORT (see
// server.js below) — separate from the orchestration service on PORT — since
// providers are meant to represent independent external services the
// Executor calls over real HTTP, not in-process function calls.
function createProvidersApp() {
  const app = express();
  app.use(express.json());

  for (const providerId of PROVIDERS) {
    app.use(`/providers/${providerId}`, createProviderSimulator(providerId));
  }

  return app;
}

module.exports = { createProvidersApp };
