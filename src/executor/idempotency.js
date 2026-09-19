class IdempotencyGuard {
  constructor() {
    this.inFlight = new Map();
  }

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
