# PaymentOps Orchestrator

PaymentOps Orchestrator is a payment operations platform simulator. It is designed to showcase production-style fintech backend concerns: idempotent writes, auditable state transitions, append-only ledger entries, async orchestration, retries, provider callbacks, merchant webhooks, reconciliation, and operator tooling.

The current milestone is a foundation, persistence, identity, and payout-core baseline: a strict TypeScript `pnpm` monorepo with Nuxt, NestJS, shared packages, Docker Compose services, CI, SQL Server migrations, tenant/client/key/webhook tables, RBAC-protected admin routes, API-key authentication, Auth0 JWT validation, idempotent payout creation, ledger entries, outbox events, worker dispatch, provider simulator callbacks, and a usable dashboard shell.

## Workspace

```text
apps/
  api/                  NestJS HTTP API with health, Swagger, auth, migrations, tenant operations, and payout core
  worker/               NestJS worker that dispatches payout outbox events to the provider simulator
  web/                  Nuxt 3 + Vue 3 + Pinia operator dashboard with create forms and payout visibility
  provider-simulator/   NestJS provider simulator shell
packages/
  config/               Shared environment validation and .env loading
  contracts/            Shared API and event contracts
  events/               Event envelope helpers and topic names
  logger/               Structured JSON logger
  testing/              Test helpers
  ui/                   Shared UI tokens
infra/terraform/        AWS staging scaffolding
docs/                   Architecture notes, API notes, and ADRs
```

## Prerequisites

- Node.js 22
- pnpm 10
- Docker Desktop
- GitHub CLI for the publish workflow

## Local Setup

```powershell
pnpm install
Copy-Item .env.example .env
pnpm lint
pnpm typecheck
pnpm test
docker compose config
```

Start Docker Desktop before running the full stack:

```powershell
pnpm docker:up
```

Run migrations explicitly when you want to verify the SQL Server baseline outside app startup:

```powershell
pnpm db:migrate
```

Local URLs:

- API: `http://localhost:3000`
- API docs: `http://localhost:3000/docs`
- Web dashboard: `http://localhost:3001`
- Provider simulator: `http://localhost:3003`
- Redpanda Console: `http://localhost:8080`

## Scripts

```text
pnpm dev          Run the API, worker, web, and provider simulator locally
pnpm build        Build all workspace projects
pnpm lint         Lint the workspace
pnpm typecheck    Type-check all workspace projects
pnpm test         Run unit tests
pnpm db:migrate   Build shared packages and apply SQL Server migrations
pnpm docker:up    Start the Docker Compose stack
pnpm docker:down  Stop the Docker Compose stack
```

## Identity Baseline

Admin routes accept Auth0 JWT bearer tokens and enforce role metadata. Local development also supports `x-paymentops-dev-admin-token` when `AUTH_MODE=development`; this is disabled for production by config and should only be used for local demos.

API-key routes accept either `Authorization: Bearer pops_...` or `x-api-key`. Incoming keys are SHA-256 hashed and matched against `api_keys.key_hash`; only active tenants, active clients, unrevoked keys, and unexpired keys authenticate.

Useful auth smoke endpoints:

- `GET /v1/auth/admin/session`
- `GET /v1/auth/api-key/session`

## API Baseline

- `GET /health` returns API health.
- `GET /docs` serves Swagger UI.
- `POST /v1/tenants` creates a tenant and owner membership.
- `POST /v1/tenants/:tenantId/api-clients` creates an API client.
- `POST /v1/tenants/:tenantId/api-keys` mints an API key and returns the secret once.
- `POST /v1/tenants/:tenantId/webhook-endpoints` registers an outbound webhook endpoint.
- `GET /v1/tenants/:tenantId/summary` returns tenant dashboard data, recent payouts, ledger entries, outbox events, and audit logs.
- `POST /v1/tenants/:tenantId/payouts` creates a payout with `x-api-key` and required `Idempotency-Key`.
- `GET /v1/tenants/:tenantId/payouts` lists recent payouts for the API-key tenant.
- `GET /v1/tenants/:tenantId/payouts/:payoutId` returns payout details, ledger entries, status history, and outbox events.
- `POST /v1/provider-callbacks/payouts` accepts provider simulator payout callbacks.
- `GET /v1/demo/dashboard` returns the seeded Northstar Marketplaces dashboard.
- `POST /v1/demo/seed` idempotently seeds the demo tenant.

## Persistence Baseline

The first SQL Server migration creates:

- `tenants`
- `user_memberships`
- `api_clients`
- `api_keys`
- `webhook_endpoints`
- `audit_logs`

The payout-core migration creates:

- `payouts`
- `payout_idempotency_keys`
- `ledger_entries`
- `payout_status_history`
- `outbox_events`

API startup runs pending migrations and seeds the demo tenant. The CLI migration command is idempotent and uses the workspace `.env` file.

## Payout Core

Payout creation is API-key authenticated and tenant-scoped. `Idempotency-Key` is required: replaying the same key with the same payload returns the original payout response, while reusing the same key with a different payload returns a conflict.

Each accepted payout creates:

- one `queued` payout aggregate
- two append-only ledger entries: merchant payable debit and provider clearing credit
- one payout status-history row
- one `payout.created.v1` outbox event
- one audit log entry


## Async Dispatch Baseline

The worker polls pending `payout.created.v1` outbox events and submits queued payouts to the provider simulator. Successful dispatch moves the payout to `processing`, stores the provider payout id, writes status history, creates a `payout.processing.v1` outbox event, and marks the original outbox event as published.

The provider simulator exposes `POST /v1/provider/payouts`. It returns a provider payout id immediately, then sends a delayed callback to `POST /v1/provider-callbacks/payouts`. Normal-sized payouts settle as `paid`; very large demo payouts are declined as `failed` so both paths are testable.

Dispatch failures increment the outbox attempt count and retry until the event is moved to `dead_letter` after repeated failures.

## Acceptance Criteria

- `apps/api` exposes health, Swagger, protected tenant operations, API client creation, one-time API key minting, webhook registration, demo dashboard data, Auth0 JWT validation, API-key session introspection, idempotent payout creation, provider callbacks, and payout status transitions.
- `apps/web` can create tenants, API clients, one-time API keys, webhook endpoints, API-key-backed payouts, and payout dispatch status from the dashboard shell.
- `apps/provider-simulator` exposes `GET /health` and Swagger at `/docs`.
- Shared packages compile under strict TypeScript.
- Docker Compose defines SQL Server, Redis, Redpanda, Redpanda Console, OpenTelemetry Collector, and all app services.
- GitHub Actions runs install, lint, typecheck, tests, and `docker compose config`.

## Delivery Roadmap

1. Foundation setup
2. Identity and tenancy
3. Payout core and ledger
4. Risk, approval, async orchestration, and webhooks
5. Reconciliation, observability, and AWS staging
