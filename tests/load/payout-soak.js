/* global __ENV */
import payoutScenario, { setup } from "./payout-smoke.js";

export { setup };

export const options = {
  scenarios: {
    payout_soak: {
      executor: "constant-vus",
      vus: Number(__ENV.K6_VUS || 10),
      duration: __ENV.K6_DURATION || "10m",
      gracefulStop: "30s"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<750", "p(99)<1500"],
    checks: ["rate>0.99"]
  }
};

export default payoutScenario;
