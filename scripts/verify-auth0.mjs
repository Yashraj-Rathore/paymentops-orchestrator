/* global process */
const domain = required("AUTH0_DOMAIN")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const audience = required("AUTH0_AUDIENCE");
const clientId = required("AUTH0_CLIENT_ID");

if (domain.includes("paymentops-dev") || domain.includes("your-tenant")) {
  throw new Error("AUTH0_DOMAIN still contains a placeholder tenant");
}
if (audience.includes("paymentops.local")) {
  throw new Error("AUTH0_AUDIENCE still contains the local placeholder");
}
if (clientId === "your_auth0_spa_client_id") {
  throw new Error("AUTH0_CLIENT_ID still contains the example value");
}

const issuer = `https://${domain}/`;
const response = await fetch(`${issuer}.well-known/openid-configuration`, {
  signal: AbortSignal.timeout(15_000)
});

if (!response.ok) {
  throw new Error(`Auth0 discovery returned ${response.status}`);
}

const discovery = await response.json();
if (discovery.issuer !== issuer) {
  throw new Error(`Auth0 issuer mismatch: expected ${issuer}, received ${discovery.issuer}`);
}

for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
  if (typeof discovery[key] !== "string" || !discovery[key].startsWith(issuer)) {
    throw new Error(`Auth0 discovery is missing a valid ${key}`);
  }
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      issuer,
      audience,
      clientId,
      note: "Allowed callback, logout, and web-origin URLs still require dashboard verification."
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
