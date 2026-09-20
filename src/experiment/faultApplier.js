// The bridge between a stored FaultSchedule document and the provider
// simulators' own runtime fault-config API (GET/PUT/DELETE /fault on each
// provider — see providers/providerSimulator.js). No new provider-side code
// needed here; this just calls that existing API at the right moments.
const { PROVIDERS } = require('../config/constants');

async function clearAllProviderFaults(baseUrl) {
  await Promise.all(PROVIDERS.map((providerId) => fetch(`${baseUrl}/providers/${providerId}/fault`, { method: 'DELETE' })));
}

// Called once per transactionIndex from experiment/experimentRunner.js's
// main loop. Most calls are a no-op — with ~7 events spread across 10,000
// indices, only a handful of calls actually match a start/end boundary.
// Ends are applied before starts so a fault ending and a different one
// starting at the exact same index (not the case in the default schedule,
// but not assumed away either) resolve in the right order.
async function applyFaultTransitions(events, transactionIndex, baseUrl) {
  const endingNow = events.filter((event) => event.endTransactionIndex === transactionIndex);
  for (const event of endingNow) {
    // eslint-disable-next-line no-await-in-loop
    await fetch(`${baseUrl}/providers/${event.providerId}/fault`, { method: 'DELETE' });
  }

  const startingNow = events.filter((event) => event.startTransactionIndex === transactionIndex);
  for (const event of startingNow) {
    // eslint-disable-next-line no-await-in-loop
    await fetch(`${baseUrl}/providers/${event.providerId}/fault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultType: event.faultType, params: event.params }),
    });
  }
}

module.exports = { clearAllProviderFaults, applyFaultTransitions };
