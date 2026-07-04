# Auth0 Dashboard Setup

PaymentOps uses an Auth0 Single Page Application for operators and an Auth0 API audience for the NestJS API.

## Auth0 resources

1. Create an Auth0 API with the identifier used by `AUTH0_AUDIENCE`.
2. Enable RBAC and "Add Permissions in the Access Token" for that API.
3. Create a Single Page Application and record its client ID.
4. Add the following application URLs:
   - Allowed callback URLs: `http://localhost:3001`, plus the staging HTTPS URL.
   - Allowed logout URLs: `http://localhost:3001`, plus the staging HTTPS URL.
   - Allowed web origins: `http://localhost:3001`, plus the staging HTTPS origin.
5. Create `operations_admin`, `merchant_owner`, and `developer` roles.
6. Add a post-login Auth0 Action that writes role names to the namespaced claim configured by `AUTH0_ROLE_CLAIM`.

Example Action logic:

```js
exports.onExecutePostLogin = async (event, api) => {
  const namespace = "https://paymentops.local";
  const roles = event.authorization?.roles ?? [];
  api.accessToken.setCustomClaim(namespace + "/roles", roles);
};
```

## Local configuration

Set these values in `.env`:

```dotenv
AUTH_MODE=auth0
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=your_spa_client_id
AUTH0_AUDIENCE=https://api.paymentops.example
AUTH0_ROLE_CLAIM=https://paymentops.local/roles
NUXT_PUBLIC_AUTH_MODE=auth0
NUXT_PUBLIC_AUTH0_DOMAIN=your-tenant.us.auth0.com
NUXT_PUBLIC_AUTH0_CLIENT_ID=your_spa_client_id
NUXT_PUBLIC_AUTH0_AUDIENCE=https://api.paymentops.example
```

The user email in Auth0 must match an active `user_memberships` record. Operations administrators can access every tenant; merchant owners and developers are constrained to their active tenant memberships.

Never commit Auth0 secrets or machine credentials. The SPA client ID and API audience are public identifiers; confidential client secrets do not belong in the Nuxt application.

## Verification

Validate the public identifiers and OpenID Connect discovery document before deployment:

```powershell
$env:AUTH0_DOMAIN = "your-tenant.us.auth0.com"
$env:AUTH0_CLIENT_ID = "your_spa_client_id"
$env:AUTH0_AUDIENCE = "https://api.paymentops.example"
pnpm auth0:verify
```

The command verifies the issuer, authorization endpoint, token endpoint, and JWKS endpoint. Auth0 does not expose SPA callback settings through public discovery, so confirm the callback, logout, and web-origin entries in the Auth0 dashboard and complete one interactive tenant-scoped login before approving staging.
