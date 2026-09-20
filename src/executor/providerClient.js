// The actual HTTP call to a provider simulator. This is the piece that
// enforces Ttimeout client-side: the provider itself just never responds
// during full_outage/intermittent_timeout (see providers/providerSimulator.js),
// and it's THIS AbortController that gives up after timeoutMs and turns that
// silence into a real 'timeout' outcome — nothing about a hung connection
// becomes a "timeout" until the caller decides to stop waiting.
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
      // Report the CONFIGURED timeout, not Date.now()-startedAt — they're
      // approximately the same, but using timeoutMs directly matches
      // Section 4's rule that l(t) = Lmax exactly on a timeout, rather than
      // whatever slightly-off elapsed time the abort actually took to fire.
      return { providerId, latencyMs: timeoutMs, outcome: 'timeout' };
    }
    // Anything else (connection refused, DNS failure, etc.) — treated the
    // same as a declined authorisation for this experiment's purposes.
    return { providerId, latencyMs: Date.now() - startedAt, outcome: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { dispatchToProvider, DEFAULT_BASE_URL };
