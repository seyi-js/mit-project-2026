const { recordObservation } = require('./monitor');

function createMonitorMiddleware() {
  return function monitorMiddleware(req, res, next) {
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
