# Staging Operations Runbook

## First response

1. Open the `paymentops-staging-operations` CloudWatch dashboard.
2. Confirm the ALB target health for the API and web target groups.
3. Search the API and worker log groups by `correlationId`, payout ID, or tenant ID.
4. Check ECS service events for failed deployments, health checks, or resource exhaustion.
5. Record the start time, affected tenants, and visible symptoms.

## Elevated ALB 5xx

1. Compare `HTTPCode_ELB_5XX_Count` with target 5xx and target response time.
2. If targets are unhealthy, inspect the latest ECS deployment and container logs.
3. Roll back by updating `image_tag` to the last known-good immutable Git SHA and applying Terraform.
4. Verify `/health`, `/docs`, dashboard login, and a low-value simulator payout.

## API error alarm

1. Query `/ecs/paymentops-staging/api` for `level = "error"`.
2. Follow the `correlationId` across API, worker, provider simulator, and OTel logs.
3. Check SQL Server connections, Redis queue health, and Redpanda broker health.
4. Do not replay a payout or webhook until its idempotency key and persisted state are confirmed.

## Queue or outbox backlog

1. Inspect pending and dead-letter outbox records from the dashboard.
2. Confirm Redis and Redpanda tasks are healthy.
3. Restart only the failed worker task after the dependency is healthy.
4. Replay dead-lettered webhook deliveries from the dashboard. Payout dispatch retries remain idempotent by payout ID.
5. Escalate if the oldest pending event exceeds 15 minutes.

## Database migration failure

1. Stop the API deployment from replacing healthy tasks.
2. Read the failed migration version from startup logs and `dbo.schema_migrations`.
3. Restore or snapshot SQL Server before manual remediation.
4. Never edit an applied migration. Add a forward-only corrective migration and validate it in a fresh database.
5. Re-run the API task and confirm all temporal tables report `temporal_type = 2`.

## Reconciliation discrepancy handling

1. Open the relevant settlement import and compare provider and internal payout identifiers.
2. Record the investigation outcome in the resolution note.
3. Resolve the discrepancy once; the API writes an audit record, temporal history, and outbox event.
4. Download the settlement CSV report and attach it to the incident or settlement ticket.

## Security events

1. Review sampled WAF requests and the WAF log group.
2. For a compromised API key, revoke it and rotate the parent client credential.
3. For a compromised Auth0 account, disable the Auth0 user and the PaymentOps membership.
4. Preserve audit logs and correlation IDs before making cleanup changes.

## Recovery verification

- ALB targets are healthy for three consecutive checks.
- API `/health` and dashboard load over HTTPS.
- Auth0 login succeeds with a tenant-scoped operator.
- A simulator payout reaches `paid`.
- The signed merchant webhook is delivered.
- CloudWatch alarms return to `OK`.
