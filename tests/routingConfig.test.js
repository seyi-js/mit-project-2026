require('dotenv').config();
const mongoose = require('mongoose');

const RoutingConfig = require('../src/models/RoutingConfig');
const { ensureRoutingConfigExists, DEFAULT_WEIGHTS } = require('../src/experiment/routingConfig');

const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/adaptive-payment-orchestration-test';

beforeAll(async () => {
  await mongoose.connect(TEST_MONGODB_URI);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await RoutingConfig.deleteMany({});
});

describe('ensureRoutingConfigExists', () => {
  test('creates the default weights on first call', async () => {
    const doc = await ensureRoutingConfigExists();
    expect(doc.weights.toObject()).toMatchObject(DEFAULT_WEIGHTS);
  });

  test('returns the existing stored config on a later call rather than overwriting it', async () => {
    await RoutingConfig.create({ weights: { A: 0.1, B: 0.1, C: 0.8 } });

    const doc = await ensureRoutingConfigExists();
    expect(doc.weights.toObject()).toMatchObject({ A: 0.1, B: 0.1, C: 0.8 });

    const count = await RoutingConfig.countDocuments({});
    expect(count).toBe(1);
  });
});
