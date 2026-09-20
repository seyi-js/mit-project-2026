const express = require('express');
const { createTransactionApi } = require('./api/transactionApi');

// The orchestration service's Express app — separate from providers/app.js,
// which is a different process (the simulated providers this service calls
// over HTTP). providersBaseUrl/providersTimeoutMs are only ever overridden
// in tests, to point at an ephemeral test provider server instead of the
// real one on PROVIDERS_PORT.
function createApp({ providersBaseUrl, providersTimeoutMs } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(createTransactionApi({ baseUrl: providersBaseUrl, timeoutMs: providersTimeoutMs }));

  return app;
}

module.exports = { createApp };
