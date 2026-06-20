# ADR 0001: Foundation Stack

## Status

Accepted

## Context

The project needs to demonstrate payment operations engineering: idempotency, auditability, asynchronous retries, queue visibility, reconciliation, and operator workflows.

## Decision

Use a strict TypeScript `pnpm` monorepo with:

- NestJS for the API, worker, and provider simulator.
- Nuxt 3, Vue 3, and Pinia for the dashboard.
- SQL Server as the source of truth.
- Redis for queues, throttles, dedupe windows, and short-lived coordination.
- Redpanda for Kafka-compatible event streaming.
- Auth0 as the first identity provider assumption for local and demo environments.
- Docker Compose for local development and Terraform scaffolding for AWS ECS/Fargate staging.

## Consequences

The first milestone prioritizes clear boundaries and reproducible setup. Domain implementation begins after the scaffold can lint, type-check, test, and boot locally.
