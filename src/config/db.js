// Used by the long-running processes (src/server.js, the experiment CLI
// scripts) to connect to the real MongoDB. Test files do NOT go through
// here — they call mongoose.connect() directly against a separate
// `-test` database (see any tests/*.test.js's TEST_MONGODB_URI), so
// running the test suite never touches your real/dev data.
const mongoose = require('mongoose');

async function connectDB(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB };
