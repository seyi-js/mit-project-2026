const { createProvidersApp } = require('../src/providers/app');
const { dispatchToProvider } = require('../src/executor/providerClient');

describe('dispatchToProvider', () => {
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
    await fetch(`${baseUrl}/providers/A/fault`, { method: 'DELETE' });
  });

  test('returns success for a healthy provider', async () => {
    const result = await dispatchToProvider('A', { baseUrl });
    expect(result).toMatchObject({ providerId: 'A', outcome: 'success' });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('returns error when the provider declines the authorization', async () => {
    await fetch(`${baseUrl}/providers/A/fault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultType: 'elevated_error_rate', params: { errorRate: 1 } }),
    });

    const result = await dispatchToProvider('A', { baseUrl });
    expect(result.outcome).toBe('error');
  });

  test('returns timeout and reports latencyMs == timeoutMs when the provider hangs', async () => {
    await fetch(`${baseUrl}/providers/A/fault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultType: 'full_outage' }),
    });

    const result = await dispatchToProvider('A', { baseUrl, timeoutMs: 200 });
    expect(result.outcome).toBe('timeout');
    expect(result.latencyMs).toBe(200);
  }, 10000);
});
