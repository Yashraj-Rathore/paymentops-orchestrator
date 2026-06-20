# PaymentOps Orchestrator

PaymentOps Orchestrator is a payment operations platform simulator. It is designed to showcase production-style fintech backend concerns: idempotent writes, auditable state transitions, async orchestration, retries, provider callbacks, merchant webhooks, reconciliation, and operator tooling.

This first milestone is the foundation scaffold: a strict TypeScript `pnpm` monorepo with Nuxt, NestJS, shared packages, Docker Compose services, CI, ADRs, and infrastructure placeholders.

## Workspace

```text
apps/
  api/                  NestJS HTTP API with health and Swagger shell
  worker/               NestJS worker shell for async orchestration
  web/                  Nuxt 3 + Vue 3 + Pinia operator dashboard shell
  provider-simulator/   NestJS provider simulator shell
packages/
  config/               Shared environment validation
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
pnpm docker:up    Start the Docker Compose stack
pnpm docker:down  Stop the Docker Compose stack
```

## Foundation Acceptance Criteria

- `apps/api` exposes `GET /health` and Swagger at `/docs`.
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
