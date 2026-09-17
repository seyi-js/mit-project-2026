const express = require("express");
const { FAULT_TYPES } = require("../config/constants");

function createProviderSimulator(providerId) {
  const router = express.Router();

  let activeFault = { faultType: null, params: {} };
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

    if (faultType === "full_outage") {
      return; // never responds while the outage is active
    }

    if (
      faultType === "intermittent_timeout" &&
      Math.random() < (params.timeoutRate ?? 0)
    ) {
      return; // never responds for this request
    }

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
