# Staging Operations Runbook

## GitHub environment configuration

Configure the protected `staging` environment with required reviewers and these values:

- Variables: `AWS_ROLE_ARN`, `AWS_TF_STATE_BUCKET`, `AWS_TF_STATE_KEY`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`, `DOMAIN_NAME`, `ROUTE53_ZONE_ID`, `ACM_CERTIFICATE_ARN`, and `ALERT_EMAIL`.
- Deployment secret: `DATABASE_URL_SECRET_ARN` when Terraform does not manage SQL Server.
- Performance values: `STAGING_URL`, `PERFORMANCE_TENANT_ID`, and the `PERFORMANCE_API_KEY` secret.

Use a GitHub OIDC role constrained to this repository and the `staging` environment. Do not store long-lived AWS access keys in GitHub.

## Deployment acceptance

1. Run `Deploy staging` with the Git SHA being deployed and `apply=false`.
2. Review the Terraform plan, ECR image scan, backup settings, certificate, WAF association, and expected cost.
3. Re-run with `apply=true` after environment approval.
4. Confirm the workflow smoke check passes for HTTPS, API health, Swagger, dashboard, and security headers.
5. Complete one Auth0 login, low-value payout, provider callback, and signed merchant webhook delivery.
6. Confirm the CloudWatch dashboard is receiving data and the SNS subscription is confirmed.

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

## Backup and restore drill

Run this drill at least quarterly and after changing database infrastructure.

1. Record the source database identifier, latest restorable time, subnet group, security group, parameter group, and current application image SHA.
2. Restore to a new isolated identifier with the AWS console or:

```powershell
aws rds restore-db-instance-to-point-in-time `
  --source-db-instance-identifier paymentops-staging `
  --target-db-instance-identifier paymentops-staging-restore-drill `
  --use-latest-restorable-time `
  --db-subnet-group-name paymentops-staging `
  --vpc-security-group-ids <database-security-group-id> `
  --no-publicly-accessible
```

3. Create a temporary Secrets Manager value that points to the restored endpoint. Do not replace the active application secret.
4. Run migrations and the staging smoke test from isolated ECS tasks, then verify payout, ledger, temporal history, audit, outbox, and reconciliation row counts.
5. Record recovery point and recovery time measurements, remove temporary credentials, and destroy the restored instance after evidence is retained.
6. For a snapshot-specific exercise, use `aws rds restore-db-instance-from-db-snapshot` and follow the same isolation and validation steps.

Deletion protection must be disabled in a separately reviewed Terraform apply before intentional database destruction. Keep `database_skip_final_snapshot=false` unless a replacement snapshot has already been verified.

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

## Performance and security verification

- Run the manual `Staging performance` workflow with 10 virtual users for 10 minutes, then increase load only after reviewing SQL, worker, Redis, Redpanda, and ALB saturation.
- Require `pnpm security:audit`, CI, E2E, contract, and Playwright checks before deployment.
- Review ECR enhanced scan results and sampled WAF requests before promoting an image.
- Revoke the dedicated performance API key after testing if it is not retained for recurring drills.
