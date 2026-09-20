const express = require("express");
const { FAULT_TYPES } = require("../config/constants");

// One simulated payment provider (Section 6), as its own Express router.
// Each call to this factory gets its OWN closure-scoped activeFault state —
// providers/app.js mounts three independent instances (A/B/C), so tripping a
// fault on one never leaks into another. Reconfigured at runtime via the
// GET/PUT/DELETE /fault endpoints below (that's what the fault schedule
// replayer in experiment/faultApplier.js actually calls during a run).
function createProviderSimulator(providerId) {
  const router = express.Router();

  let activeFault = { faultType: null, params: {} };
  // Counts requests since the CURRENT fault was activated — only used by
  // degraded_latency's optional gradual ramp (see below). Reset whenever the
  // fault config changes.
  let requestsSinceFaultStart = 0;

  router.get("/fault", (req, res) => {
    res.json({ providerId, ...activeFault });
  });

  router.put("/fault", (req, res) => {
    const { faultType = null, params = {} } = req.body || {};
    if (faultType !== null && !FAULT_TYPES.includes(faultType)) {
      return res.status(400).json({ error: `Unknown faultType: ${faultType}` });
    }
    activeFault = { faultType, params };
    requestsSinceFaultStart = 0;
    res.json({ providerId, ...activeFault });
  });

  router.delete("/fault", (req, res) => {
    activeFault = { faultType: null, params: {} };
    requestsSinceFaultStart = 0;
    res.json({ providerId, ...activeFault });
  });

  router.post("/authorize", (req, res) => {
    requestsSinceFaultStart += 1;
    const { faultType, params } = activeFault;

    // full_outage / intermittent_timeout deliberately just... never call
    // res.*() at all. That's the real behaviour being simulated — a hung
    // connection with no response, not an immediate error. It's the CALLER's
    // job (executor/providerClient.js's AbortController) to give up after
    // Ttimeout and treat that as a timeout outcome. This is what actually
    // makes Section 4's "l(t) = Lmax on timeout" rule true in practice.
    if (faultType === "full_outage") {
      return;
    }

    if (
      faultType === "intermittent_timeout" &&
      Math.random() < (params.timeoutRate ?? 0)
    ) {
      return;
    }

    // "gradual or sudden" (Section 6): rampRequests=0 (default) means an
    // immediate jump to the target latency; a positive rampRequests linearly
    // scales the delay up from 0 to target over that many requests since the
    // fault started, modelling a gradual degradation instead.
    let latencyMs = 0;
    if (faultType === "degraded_latency") {
      const target = params.latencyMs ?? 0;
      const rampRequests = params.rampRequests ?? 0;
      latencyMs =
        rampRequests > 0
          ? Math.min(target, (target * requestsSinceFaultStart) / rampRequests)
          : target;
    }

    setTimeout(() => {
      // Guards against writing to a socket the client already gave up on
      // (e.g. it aborted mid-delay) — without this, that write can throw and
      // crash the whole provider process on what's actually a benign,
      // expected disconnect.
      if (res.destroyed || res.writableEnded) return;

      if (
        faultType === "elevated_error_rate" &&
        Math.random() < (params.errorRate ?? 0)
      ) {
        return res
          .status(402)
          .json({ providerId, status: "declined", latencyMs });
      }
      res.status(200).json({ providerId, status: "authorized", latencyMs });
    }, latencyMs);
  });

  return router;
}

module.exports = { createProviderSimulator };
