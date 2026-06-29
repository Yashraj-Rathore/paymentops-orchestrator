# PaymentOps Architecture

PaymentOps Orchestrator uses SQL Server as the source of truth, Redis and BullMQ for durable jobs, and Redpanda for Kafka-compatible domain-event streaming.

## Process Boundaries

- `apps/api`: request/response API, Auth0 and API-key authentication, tenant operations, payout writes, approvals, reconciliation, and transactional outbox creation.
- `apps/worker`: leased outbox relay, Redpanda publication, BullMQ payout processing, signed merchant webhook delivery, retries, and dead-letter handling.
- `apps/provider-simulator`: external payout provider simulator for callbacks and failure modes.
- `apps/web`: merchant/operator dashboard.

## Asynchronous Guarantees

SQL transactions write domain state and outbox rows together. Worker instances claim rows with expiring SQL leases and publish at least once to `paymentops.<event-type>` topics. BullMQ custom job ids suppress duplicate queue insertion during relay retries. Consumers remain idempotent because a crash can occur after broker acknowledgement but before SQL publication state is committed.

Payout and webhook jobs retry with exponential backoff. Terminal failures are retained by BullMQ, mirrored into the `paymentops-dead-letter` queue, and recorded in SQL audit and domain state. Webhook replay clears the SQL queue reservation so the recovery scheduler can issue a new job.

## Shared Packages

- `config`: typed environment loading.
- `logger`: trace-correlated structured JSON logs.
- `contracts`: shared HTTP and event DTOs.
- `events`: event envelope, topic, and webhook signature helpers.
- `observability`: OpenTelemetry traces, metrics, and correlation context.
- `testing`: reusable test helpers.
- `ui`: shared visual tokens.