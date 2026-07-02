/* global __ENV */
import http from "k6/http";
import { check, fail, sleep } from "k6";
import exec from "k6/execution";

const apiBaseUrl = __ENV.PAYMENTOPS_API_URL || "http://127.0.0.1:3000";
const adminToken = __ENV.PAYMENTOPS_DEV_ADMIN_TOKEN || "dev-admin-token";
const adminHeaders = {
  headers: {
    "content-type": "application/json",
    "x-paymentops-dev-admin-token": adminToken
  }
};

export const options = {
  scenarios: {
    payout_smoke: {
      executor: "constant-vus",
      vus: Number(__ENV.K6_VUS || 3),
      duration: __ENV.K6_DURATION || "10s"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
    checks: ["rate>0.99"]
  }
};

export function setup() {
  const suffix = String(Date.now());
  const tenant = requestJson(
    "POST",
    apiBaseUrl + "/v1/tenants",
    { name: "k6 merchant " + suffix, ownerEmail: "k6-" + suffix + "@paymentops.test" },
    adminHeaders
  );
  const client = requestJson(
    "POST",
    apiBaseUrl + "/v1/tenants/" + tenant.id + "/api-clients",
    { name: "k6 client" },
    adminHeaders
  );
  const key = requestJson(
    "POST",
    apiBaseUrl + "/v1/tenants/" + tenant.id + "/api-keys",
    {
      apiClientId: client.id,
      name: "k6 payout key",
      permissions: ["payouts:create", "payouts:read"]
    },
    adminHeaders
  );

  return { tenantId: tenant.id, apiKey: key.secret };
}

export default function (data) {
  const iteration = exec.scenario.iterationInTest;
  const response = http.post(
    apiBaseUrl + "/v1/tenants/" + data.tenantId + "/payouts",
    JSON.stringify({
      amountMinor: 1000 + (iteration % 100),
      currency: "USD",
      destinationAccount: "acct_k6_" + exec.vu.idInTest,
      reference: "k6-" + iteration
    }),
    {
      headers: {
        "content-type": "application/json",
        "idempotency-key": "k6-" + exec.vu.idInTest + "-" + iteration,
        "x-api-key": data.apiKey
      }
    }
  );

  check(response, {
    "payout accepted": (result) => result.status === 201,
    "payout has id": (result) => Boolean(result.json("id"))
  });
  sleep(0.2);
}

function requestJson(method, url, body, params) {
  const response = http.request(method, url, JSON.stringify(body), params);
  if (response.status < 200 || response.status >= 300) {
    fail(method + " " + url + " returned " + response.status + ": " + response.body);
  }
  return response.json();
}
