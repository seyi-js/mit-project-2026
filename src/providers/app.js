const express = require('express');
const { PROVIDERS } = require('../config/constants');
const { createProviderSimulator } = require('./providerSimulator');

function createProvidersApp() {
  const app = express();
  app.use(express.json());

  for (const providerId of PROVIDERS) {
    app.use(`/providers/${providerId}`, createProviderSimulator(providerId));
  }

  return app;
}

module.exports = { createProvidersApp };
