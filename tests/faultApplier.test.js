const { createProvidersApp } = require('../src/providers/app');
const { clearAllProviderFaults, applyFaultTransitions } = require('../src/experiment/faultApplier');

describe('faultApplier', () => {
  let server;
  let baseUrl;

  beforeAll((done) => {
    const app = createProvidersApp();
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    server.closeAllConnections();
    server.close(done);
  });

  afterEach(async () => {
    await clearAllProviderFaults(baseUrl);
  });

  async function getFault(providerId) {
    const res = await fetch(`${baseUrl}/providers/${providerId}/fault`);
    return res.json();
  }

  test('clearAllProviderFaults clears every provider', async () => {
    await fetch(`${baseUrl}/providers/A/fault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultType: 'full_outage' }),
    });

    await clearAllProviderFaults(baseUrl);
    expect((await getFault('A')).faultType).toBeNull();
  });

  test('applyFaultTransitions activates a fault at its startTransactionIndex', async () => {
    const events = [
      { providerId: 'A', faultType: 'full_outage', startTransactionIndex: 5, endTransactionIndex: 10, params: {} },
    ];

    await applyFaultTransitions(events, 4, baseUrl);
    expect((await getFault('A')).faultType).toBeNull();

    await applyFaultTransitions(events, 5, baseUrl);
    expect((await getFault('A')).faultType).toBe('full_outage');
  });

  test('applyFaultTransitions clears the fault at its endTransactionIndex', async () => {
    const events = [
      { providerId: 'A', faultType: 'full_outage', startTransactionIndex: 5, endTransactionIndex: 10, params: {} },
    ];

    await applyFaultTransitions(events, 5, baseUrl);
    expect((await getFault('A')).faultType).toBe('full_outage');

    await applyFaultTransitions(events, 10, baseUrl);
    expect((await getFault('A')).faultType).toBeNull();
  });

  test('multiple providers can have independent, staggered fault windows', async () => {
    const events = [
      { providerId: 'A', faultType: 'full_outage', startTransactionIndex: 5, endTransactionIndex: 10, params: {} },
      { providerId: 'B', faultType: 'elevated_error_rate', startTransactionIndex: 5, endTransactionIndex: 8, params: { errorRate: 0.5 } },
    ];

    await applyFaultTransitions(events, 5, baseUrl);
    expect((await getFault('A')).faultType).toBe('full_outage');
    expect((await getFault('B')).faultType).toBe('elevated_error_rate');

    await applyFaultTransitions(events, 8, baseUrl);
    expect((await getFault('A')).faultType).toBe('full_outage');
    expect((await getFault('B')).faultType).toBeNull();
  });
});
