# Foundation Architecture

PaymentOps Orchestrator uses SQL Server as the source of truth, Redis for queues and short-lived coordination, and Redpanda for event streaming.

The foundation milestone intentionally keeps the domain thin. It establishes the process boundaries and shared contracts so later milestones can add tenancy, payouts, ledgers, and reconciliation without reshaping the repo.

## Process Boundaries

- `apps/api`: request/response API, auth, admin actions, and write-side application services.
- `apps/worker`: outbox publishing, queues, webhook delivery, reconciliation jobs, and report generation.
- `apps/provider-simulator`: external payout provider simulator for callbacks and failure modes.
- `apps/web`: merchant/operator dashboard.

## Shared Packages

- `config`: typed environment loading.
- `logger`: structured JSON logs.
- `contracts`: shared HTTP and event DTOs.
- `events`: event envelope and topic helpers.
- `testing`: reusable test helpers.
- `ui`: shared visual tokens.
