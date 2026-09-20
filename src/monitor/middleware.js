// NOT actually wired into the live Transaction API (api/transactionApi.js) —
// this fire-and-forget "record after the response finishes" pattern only
// captures ONE observation per HTTP response, but a single transaction can
// involve up to 3 dispatch attempts, and the adaptive strategy needs each
// attempt's freshly-updated HealthScore before picking the next provider.
// That requires calling recordObservation() synchronously inside the retry
// loop instead (see api/transactionProcessor.js), which is what actually
// happens. This file is kept because it's still a valid, tested, generic
// Express-middleware implementation of "Monitor" per Section 2's
// architecture table — just not the mechanism this particular pipeline uses.
const { recordObservation } = require('./monitor');

function createMonitorMiddleware() {
  return function monitorMiddleware(req, res, next) {
    // Deliberately not awaited — Monitor logging should never slow down or
    // fail the caller's response.
    res.on('finish', () => {
      const observation = res.locals.dispatchObservation;
      if (!observation) return;

      recordObservation(observation).catch((err) => {
        console.error('Monitor failed to record observation:', err);
      });
    });
    next();
  };
}

module.exports = { createMonitorMiddleware };
