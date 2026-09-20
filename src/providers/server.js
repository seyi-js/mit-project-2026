// Standalone entry point: `npm run start:providers`. Must be running
// (on PROVIDERS_PORT, default 4000) before you start the orchestration
// service, run an experiment, or run the executor/providerClient tests that
// hit a real port rather than an ephemeral test server.
require('dotenv').config();
const { createProvidersApp } = require('./app');

const PORT = process.env.PROVIDERS_PORT || 4000;

const app = createProvidersApp();
app.listen(PORT, () => {
  console.log(`Provider simulators (A, B, C) listening on port ${PORT}`);
});
