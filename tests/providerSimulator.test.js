const request = require('supertest');
const { createProvidersApp } = require('../src/providers/app');

describe('provider simulators', () => {
  let app;
  let server;

  beforeAll((done) => {
    app = createProvidersApp();
    server = app.listen(0, done);
  });

  afterAll((done) => {
    server.closeAllConnections();
    server.close(done);
  });

  afterEach(async () => {
    await request(server).delete('/providers/A/fault');
    await request(server).delete('/providers/B/fault');
    await request(server).delete('/providers/C/fault');
  });

  test('authorizes successfully with no fault configured', async () => {
    const res = await request(server).post('/providers/A/authorize');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ providerId: 'A', status: 'authorized', latencyMs: 0 });
  });

  test('rejects an unknown fault type', async () => {
    const res = await request(server).put('/providers/A/fault').send({ faultType: 'not_a_real_fault' });
    expect(res.status).toBe(400);
  });

  test('degraded_latency delays the response by the configured amount', async () => {
    await request(server).put('/providers/A/fault').send({
      faultType: 'degraded_latency',
      params: { latencyMs: 200 },
    });

    const start = Date.now();
    const res = await request(server).post('/providers/A/authorize');
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.body.latencyMs).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(190);
  });

  test('degraded_latency ramps up gradually over rampRequests', async () => {
    await request(server).put('/providers/A/fault').send({
      faultType: 'degraded_latency',
      params: { latencyMs: 100, rampRequests: 2 },
    });

    const first = await request(server).post('/providers/A/authorize');
    const second = await request(server).post('/providers/A/authorize');
    const third = await request(server).post('/providers/A/authorize');

    expect(first.body.latencyMs).toBe(50);
    expect(second.body.latencyMs).toBe(100);
    expect(third.body.latencyMs).toBe(100);
  });

  test('elevated_error_rate declines every request when errorRate is 1', async () => {
    await request(server).put('/providers/B/fault').send({
      faultType: 'elevated_error_rate',
      params: { errorRate: 1 },
    });

    const res = await request(server).post('/providers/B/authorize');
    expect(res.status).toBe(402);
    expect(res.body.status).toBe('declined');
  });

  test('intermittent_timeout never responds when timeoutRate is 1', async () => {
    await request(server).put('/providers/C/fault').send({
      faultType: 'intermittent_timeout',
      params: { timeoutRate: 1 },
    });

    await expect(
      request(server).post('/providers/C/authorize').timeout({ response: 300 })
    ).rejects.toThrow();
  });

  test('full_outage never responds to any request', async () => {
    await request(server).put('/providers/A/fault').send({ faultType: 'full_outage' });

    await expect(
      request(server).post('/providers/A/authorize').timeout({ response: 300 })
    ).rejects.toThrow();
  });

  test('clearing a fault restores normal authorization', async () => {
    await request(server).put('/providers/A/fault').send({
      faultType: 'elevated_error_rate',
      params: { errorRate: 1 },
    });
    await request(server).delete('/providers/A/fault');

    const res = await request(server).post('/providers/A/authorize');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('authorized');
  });

  test('fault state is independent per provider', async () => {
    await request(server).put('/providers/A/fault').send({ faultType: 'full_outage' });

    const res = await request(server).post('/providers/B/authorize');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('authorized');
  });
});
