/* global process */
const rawBaseUrl = required("PAYMENTOPS_STAGING_URL");
const baseUrl = new URL(rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`);
const allowHttp = process.env.PAYMENTOPS_ALLOW_HTTP === "true";

if (baseUrl.protocol !== "https:" && !allowHttp) {
  throw new Error("PAYMENTOPS_STAGING_URL must use HTTPS");
}

const checks = [];

async function request(path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000)
  });
  checks.push({ path, status: response.status });
  return response;
}

function expectHeader(response, name, expected) {
  const value = response.headers.get(name);
  if (!value || (expected && !value.toLowerCase().includes(expected.toLowerCase()))) {
    throw new Error(`${response.url} is missing ${name}: ${expected ?? "required"}`);
  }
}

const health = await request("health");
if (!health.ok) {
  throw new Error(`Health check returned ${health.status}`);
}
const healthBody = await health.json();
if (healthBody.status !== "ok") {
  throw new Error("Health response did not report status=ok");
}
expectHeader(health, "x-content-type-options", "nosniff");
if (baseUrl.protocol === "https:") {
  expectHeader(health, "strict-transport-security");
}

const dashboard = await request("");
if (!dashboard.ok) {
  throw new Error(`Dashboard returned ${dashboard.status}`);
}
expectHeader(dashboard, "x-content-type-options", "nosniff");
expectHeader(dashboard, "x-frame-options", "deny");

const docs = await request("docs");
if (!docs.ok) {
  throw new Error(`API documentation returned ${docs.status}`);
}

const accessToken = process.env.PAYMENTOPS_AUTH0_ACCESS_TOKEN;
if (accessToken) {
  const session = await request("v1/auth/admin/session", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!session.ok) {
    throw new Error(`Authenticated session check returned ${session.status}`);
  }
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      baseUrl: baseUrl.origin,
      authenticatedSessionChecked: Boolean(accessToken),
      checks
    },
    null,
    2
  )
);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
