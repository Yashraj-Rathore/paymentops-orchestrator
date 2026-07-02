# PaymentOps Orchestrator

PaymentOps Orchestrator is a payment operations platform simulator. It is designed to showcase production-style fintech backend concerns: idempotent writes, auditable state transitions, append-only ledger entries, async orchestration, retries, provider callbacks, merchant webhooks, reconciliation, and operator tooling.

The current milestone is a foundation, persistence, identity, payout-core, risk-approval, webhook-delivery, reconciliation, and observability baseline: a strict TypeScript `pnpm` monorepo with Nuxt, NestJS, shared packages, Docker Compose services, CI, SQL Server migrations, tenant/client/key/webhook/risk tables, RBAC-protected admin routes, API-key authentication, Auth0 JWT validation, idempotent payout creation, ledger entries, approval gating, outbox events, Redpanda publication, BullMQ/Redis job processing, provider simulator callbacks, signed merchant webhook delivery, replay, provider settlement CSV reconciliation, discrepancy tracking, OpenTelemetry traces and metrics, correlated structured logs, a usable dashboard shell, and a no-apply AWS ECS/Fargate staging baseline.

## Workspace

```text
apps/
  api/                  NestJS HTTP API with health, Swagger, auth, migrations, tenant operations, and payout core
  worker/               NestJS worker that dispatches provider payouts and merchant webhooks
  web/                  Nuxt 3 + Vue 3 + Pinia operator dashboard with create forms and payout visibility
  provider-simulator/   NestJS provider simulator shell
packages/
  config/               Shared environment validation and .env loading
  contracts/            Shared API and event contracts
  events/               Event envelope helpers and topic names
  logger/               Trace-correlated structured JSON logger
  observability/        OpenTelemetry SDK, OTLP exporters, request metrics, and correlation context
  testing/              Test helpers
  ui/                   Shared UI tokens
infra/terraform/        AWS staging infrastructure and reusable Terraform modules
docs/                   Architecture notes, API notes, and ADRs
```

## Prerequisites

- Node.js 22
- pnpm 10
- Docker Desktop
- GitHub CLI for the publish workflow
- Terraform 1.8+ and AWS CLI v2 for staging infrastructure

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
- Prometheus metrics: `http://localhost:8889/metrics`

## Scripts

```text
pnpm dev          Run the API, worker, web, and provider simulator locally
pnpm build        Build all workspace projects
pnpm lint         Lint the workspace
pnpm typecheck    Type-check all workspace projects
pnpm test         Run unit tests
pnpm test:e2e     Run the isolated Docker payout orchestration test
pnpm test:contract Generate and verify the worker/provider Pact
pnpm test:ui      Run Playwright tests against the running stack
pnpm test:load    Run the k6 payout smoke profile against the running API
pnpm db:migrate   Build shared packages and apply SQL Server migrations
pnpm docker:up    Start the Docker Compose stack
pnpm docker:down  Stop the Docker Compose stack
```

## Identity Baseline

Admin routes accept Auth0 JWT bearer tokens and enforce role metadata. Local development also supports `x-paymentops-dev-admin-token` when `AUTH_MODE=development`; this is disabled for production by config and should only be used for local demos.

API-key routes accept either `Authorization: Bearer pops_...` or `x-api-key`. Incoming keys are SHA-256 hashed and matched against `api_keys.key_hash`; only active tenants, active clients, unrevoked keys, and unexpired keys authenticate.

Set `AUTH_MODE=auth0`, `NUXT_PUBLIC_AUTH_MODE=auth0`, and the Auth0 domain, SPA client id, and API audience values to enable Universal Login in the dashboard. Add `http://localhost:3001` to the Auth0 application's allowed callback and logout URLs. Auth0 users are resolved against active tenant memberships by email; operations administrators retain cross-tenant access.

Useful auth smoke endpoints:

- `GET /v1/auth/admin/session`
- `GET /v1/auth/api-key/session`

## API Baseline

- `GET /health` returns API health.
- `GET /docs` serves Swagger UI.
- `POST /v1/tenants` creates a tenant and owner membership.
- `PATCH /v1/tenants/:tenantId` updates a tenant name or lifecycle status.
- `POST /v1/tenants/:tenantId/memberships` creates an invited or active membership.
- `PATCH /v1/tenants/:tenantId/memberships/:membershipId` updates a member role or status.
- `POST /v1/tenants/:tenantId/api-clients` creates an API client.
- `PATCH /v1/tenants/:tenantId/api-clients/:clientId` enables or disables an API client.
- `POST /v1/tenants/:tenantId/api-keys` mints an API key and returns the secret once.
- `POST /v1/tenants/:tenantId/api-keys/:apiKeyId/rotate` atomically revokes and replaces a key.
- `POST /v1/tenants/:tenantId/api-keys/:apiKeyId/revoke` revokes a key immediately.
- `POST /v1/tenants/:tenantId/webhook-endpoints` registers an outbound webhook endpoint and returns the signing secret once.
- `PATCH /v1/tenants/:tenantId/webhook-endpoints/:webhookId` updates or disables an endpoint.
- `DELETE /v1/tenants/:tenantId/webhook-endpoints/:webhookId` soft-deletes an endpoint.
- `GET /v1/tenants/:tenantId/summary` returns tenant dashboard data, recent payouts, ledger entries, outbox events, webhook deliveries, and audit logs.
- `POST /v1/tenants/:tenantId/payouts` creates a payout with `x-api-key` and required `Idempotency-Key`.
- `GET /v1/tenants/:tenantId/payouts` lists recent payouts for the API-key tenant.
- `GET /v1/tenants/:tenantId/payouts/:payoutId` returns payout details, ledger entries, status history, and outbox events.
- `POST /v1/provider-callbacks/payouts` accepts provider simulator payout callbacks.
- `GET /v1/tenants/:tenantId/webhook-deliveries` lists recent webhook delivery attempts.
- `POST /v1/tenants/:tenantId/webhook-deliveries/:deliveryId/replay` requeues a delivery for replay.
- `POST /v1/tenants/:tenantId/reconciliation/imports` imports and reconciles a provider settlement CSV.
- `GET /v1/tenants/:tenantId/reconciliation/imports` lists recent settlement imports.
- `GET /v1/tenants/:tenantId/reconciliation/imports/:importId` returns settlement rows and discrepancies.
- `POST /v1/tenants/:tenantId/reconciliation/discrepancies/:discrepancyId/resolve` records an audited resolution.
- `GET /v1/tenants/:tenantId/reconciliation/reports/settlements.csv` exports settlement results.
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

The webhook-delivery migration adds endpoint signing secrets and creates:

- `webhook_deliveries`
- `webhook_delivery_attempts`

The reconciliation migration creates:

- `settlement_imports`
- `settlement_rows`
- `reconciliation_discrepancies`

API startup runs pending migrations and seeds the demo tenant. The CLI migration command is idempotent and uses the workspace `.env` file.

## Payout Core

Payout creation is API-key authenticated and tenant-scoped. `Idempotency-Key` is required: replaying the same key with the same payload returns the original payout response, while reusing the same key with a different payload returns a conflict.

Each accepted payout creates:

- one `queued` payout aggregate
- two append-only ledger entries: merchant payable debit and provider clearing credit
- one payout status-history row
- one `payout.created.v1` outbox event
- one audit log entry

## Risk And Approval Workflow

The demo tenant seeds a high-value payout rule: USD payouts at or above 100000 minor units require approval. Matching payouts are created as `needs_approval`, get a `payout_approvals` row, and emit `payout.approval_requested.v1` instead of going directly to provider dispatch.

Operations users can approve or reject from the dashboard. Approving records the decision, moves the payout to `queued`, emits `payout.approved.v1`, and enqueues `payout.created.v1` so the existing worker dispatch path handles provider submission. Rejecting records the decision, moves the payout to `canceled`, and emits `payout.rejected.v1`.

## Durable Async Dispatch

The worker leases pending SQL outbox rows, publishes event envelopes to `paymentops.<event-type>` Redpanda topics, and marks publication state only after the broker and internal queue accept the work. Lease expiry and deterministic BullMQ job ids make relay recovery safe across worker restarts.

`payout.created.v1` events enqueue Redis-backed BullMQ jobs. Successful dispatch moves the payout to `processing`, stores the provider payout id, writes status history, and creates a new `payout.processing.v1` outbox event. BullMQ applies exponential retries; the final failure moves the payout to `failed`, records an audit entry, emits `payout.failed.v1`, and mirrors the failed job into `paymentops-dead-letter`.

The provider simulator exposes `POST /v1/provider/payouts`. It returns a provider payout id immediately, then sends a delayed callback to `POST /v1/provider-callbacks/payouts`. Normal-sized payouts settle as `paid`; very large demo payouts are declined as `failed` so both paths are testable.

## Merchant Webhook Delivery

The worker creates webhook delivery records for active endpoints whose subscriptions match payout outbox events. Delivery payloads are signed with HMAC SHA-256 and include these headers:

- `PaymentOps-Signature`
- `PaymentOps-Timestamp`
- `PaymentOps-Event-Id`
- `PaymentOps-Delivery-Id`

Each delivery records attempts, HTTP status, response body snippets, last error, delivered timestamp, retry schedule, and dead-letter state. Failed and dead-lettered deliveries can be replayed through the API and dashboard.

## Settlement Reconciliation

Operations users can upload provider settlement CSVs with these columns:

```text
provider_payout_id,amount_minor,currency,status,settled_at
```

Each import is hashed to prevent duplicate processing and reconciled transactionally against tenant payouts by provider payout id. Rows are classified as `matched`, `missing`, or `amount_mismatch`; non-matches create open discrepancy records. Completion writes an audit entry and a `reconciliation.completed.v1` outbox event. Discrepancy resolution is idempotent and emits its own audit record and outbox event. Mutable tenant, client, webhook, payout, approval, and discrepancy tables use SQL Server system-versioned temporal history.

The dashboard includes a sample CSV generator, import history, row-level results, and discrepancy details.

## Observability Baseline

The API, worker, and provider simulator initialize OpenTelemetry before loading NestJS. Automatic Node.js instrumentation exports distributed HTTP traces through OTLP, while the shared middleware records request counts and latency histograms. Payment operations emit the `paymentops.operation.count` counter for payout, approval, reconciliation, provider dispatch, and webhook outcomes.

Incoming HTTP requests preserve or create an `x-correlation-id` header. Structured logs automatically include the active trace and correlation identifiers, making synchronous HTTP chains easy to correlate. Worker payout and webhook jobs create dedicated spans so each asynchronous operation is independently traceable.

The local collector prints trace summaries and exposes OTLP metrics in Prometheus format at `http://localhost:8889/metrics`. Set `OTEL_SDK_DISABLED=true` to disable SDK initialization.

## Acceptance Criteria

- `apps/api` exposes health, Swagger, protected tenant operations, API client creation, one-time API key minting, webhook registration, webhook delivery replay, demo dashboard data, Auth0 JWT validation, API-key session introspection, idempotent payout creation, provider callbacks, and payout status transitions.
- `apps/web` can create tenants, API clients, one-time API keys, webhook endpoints, API-key-backed payouts, payout dispatch status, webhook delivery status, webhook replays, settlement imports, and reconciliation discrepancies from the dashboard shell.
- `apps/provider-simulator` exposes `GET /health` and Swagger at `/docs`.
- Shared packages compile under strict TypeScript.
- Docker Compose defines SQL Server, Redis, Redpanda, Redpanda Console, an OTLP collector with Prometheus metrics, and all app services.
- GitHub Actions runs install, lint, typecheck, tests, build, Compose validation, and Terraform format/validation checks.
- The payout orchestration E2E test proves API idempotency, SQL ledger writes, outbox relay, BullMQ dispatch, provider callbacks, final payout state, and signed merchant webhook delivery against an isolated Docker Compose stack.
- Terraform defines the staging VPC, ALB, ECR, ECS/Fargate services, Service Connect, CloudWatch logs, IAM, Secrets Manager integration, and optional SQL Server.

## End-to-End Payout Test

Start Docker Desktop, then run:

```powershell
pnpm test:e2e
```

The test creates a separate Compose project with fresh volumes and a randomly published API port, so it does not reuse the normal development database. It starts the API, worker, provider simulator, SQL Server, Redis, and Redpanda; creates a tenant, client, API key, and webhook; submits the same idempotent payout twice; and waits for the provider callback and verified `payout.paid.v1` webhook. The stack is removed afterward. Set `PAYMENTOPS_E2E_KEEP_RUNNING=true` to retain it for debugging; Compose logs are written to `test-results/e2e-compose.log`.

## Delivery Roadmap

1. Foundation setup
2. Identity and tenancy
3. Payout core and ledger
4. Risk, approval, async orchestration, and webhook hardening
5. Reconciliation, observability, and AWS staging

## Operations Guides

- `docs/auth0-setup.md` configures Universal Login, RBAC roles, and tenant membership mapping.
- `docs/runbooks/staging-operations.md` covers alarms, rollback, async recovery, database migrations, and reconciliation response.
- `.github/workflows/deploy-staging.yml` provides the OIDC-authenticated manual staging plan/apply path.
