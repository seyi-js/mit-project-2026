require('dotenv').config();
const { createProvidersApp } = require('./app');

const PORT = process.env.PROVIDERS_PORT || 4000;

const app = createProvidersApp();
app.listen(PORT, () => {
  console.log(`Provider simulators (A, B, C) listening on port ${PORT}`);
});
