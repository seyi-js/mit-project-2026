const { TIMING } = require('../config/constants');

const DEFAULT_BASE_URL = `http://127.0.0.1:${process.env.PROVIDERS_PORT || 4000}`;

async function dispatchToProvider(providerId, { baseUrl = DEFAULT_BASE_URL, timeoutMs = TIMING.T_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}/providers/${providerId}/authorize`, {
      method: 'POST',
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    return { providerId, latencyMs, outcome: response.status === 200 ? 'success' : 'error' };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { providerId, latencyMs: timeoutMs, outcome: 'timeout' };
    }
    return { providerId, latencyMs: Date.now() - startedAt, outcome: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { dispatchToProvider, DEFAULT_BASE_URL };
