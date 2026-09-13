require('dotenv').config();
const { createApp } = require('./app');
const { connectDB } = require('./config/db');

const PORT = process.env.PORT || 3000;

async function main() {
  await connectDB();
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Orchestration service listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
