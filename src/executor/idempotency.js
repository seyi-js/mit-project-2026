// In-memory only (a plain Map, per-process) — deliberately a class you
// instantiate rather than one shared module-level singleton, so tests (and
// different callers) get independent, isolated state instead of leaking into
// each other. In practice, api/transactionProcessor.js keeps ONE shared
// instance for the life of the process and uses it to dedupe a whole
// transaction's retry sequence by transactionId — not per individual
// provider dispatch, since a duplicate whole-transaction submission is the
// real thing this protects against (e.g. a client retrying because it never
// saw the response), not a legitimate retry to a different provider.
class IdempotencyGuard {
  constructor() {
    this.inFlight = new Map();
  }

  // First call with `key` runs fn and caches its promise; any call with the
  // same key while that's still pending — or after it resolved — gets back
  // the exact same promise/value instead of running fn again. A rejection
  // clears the key (see catch below) so a genuinely failed attempt CAN be
  // retried later, rather than being permanently stuck replaying the same error.
  execute(key, fn) {
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }

    const promise = Promise.resolve()
      .then(fn)
      .catch((err) => {
        this.inFlight.delete(key);
        throw err;
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  has(key) {
    return this.inFlight.has(key);
  }

  clear(key) {
    this.inFlight.delete(key);
  }
}

module.exports = { IdempotencyGuard };
