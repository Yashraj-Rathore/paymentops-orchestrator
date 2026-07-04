# AWS Staging Infrastructure

Terraform provisions a no-apply staging baseline for PaymentOps Orchestrator in `ca-central-1`:

- A DNS-enabled VPC spanning two availability zones
- Public subnets for the Application Load Balancer and Fargate tasks
- Isolated private subnets for optional RDS for SQL Server Express
- ECR, ECS/Fargate, Service Connect, CloudWatch Logs, alarms, dashboards, and task IAM roles
- API, web, worker, provider simulator, single-node Redis and Redpanda, and AWS Distro for OpenTelemetry services
- Secrets Manager injection of `DATABASE_URL`
- Optional ACM certificate creation, Route 53 aliasing, HTTPS redirect, and AWS managed WAF rules
- SNS-backed alarms for ALB 5xx responses, unhealthy targets, and structured API errors
- SQL Server automated backup retention, deletion protection, final snapshots, and recoverable database secrets

The defaults are deliberately conservative: ECS services and SQL Server are disabled, while Fargate Spot is selected for staging. Redis and Redpanda run as single-node ephemeral Fargate services for demonstration only; production must use durable managed equivalents. Applying this configuration creates billable AWS resources; review an AWS cost estimate first.

## Prerequisites

Install Terraform 1.8 or newer, AWS CLI v2, and Docker. Authenticate the AWS CLI to the target account and create an S3 state bucket before initialization.

```powershell
cd infra/terraform/envs/staging
Copy-Item backend.hcl.example backend.hcl
Copy-Item terraform.tfvars.example terraform.tfvars
terraform init -backend-config=backend.hcl
terraform fmt -check -recursive ../../
terraform validate
terraform plan
```

`backend.hcl` and `terraform.tfvars` are local configuration files and must not contain committed credentials.

## Bootstrap Order

1. Keep `deploy_services=false` and `create_database=false`, then apply the network, ALB, ECR, cluster, logs, and IAM baseline.
2. Build the root `Dockerfile`, tag it with an immutable Git SHA, authenticate Docker to the output ECR repository, and push the image.
3. Configure a database by setting `create_database=true`, or supply `database_url_secret_arn` for an existing Secrets Manager secret.
4. Replace the example Auth0 values, set `image_tag` and `deploy_services=true`, review the plan, and apply.
5. Verify the Terraform `public_url`, API `/health`, and `/docs` endpoints. The API initializes the database and runs pending migrations during startup.

Set `enable_https=true` with either `certificate_arn` or `create_certificate=true`, `domain_name`, and `route53_zone_id`. WAF managed rules are enabled by default. Subscribe `alert_email` and confirm the SNS email before relying on notifications. The manual `Deploy staging` workflow uses GitHub OIDC and an environment approval before Terraform apply.

Managed SQL Server defaults to seven days of automated backups, deletion protection, a seven-day Secrets Manager recovery window, and a final snapshot on destroy. An intentional teardown therefore requires two reviewed changes: disable `database_deletion_protection`, then apply again with `database_skip_final_snapshot=false`.

The deployment workflow requires an immutable Git SHA image tag, validates Auth0 discovery before planning, and runs `scripts/staging-smoke.mjs` after apply. Configure the `staging` GitHub environment with the variables and secrets listed in `docs/runbooks/staging-operations.md`.

See `docs/runbooks/staging-operations.md` for incident response, rollback, queue recovery, migration handling, and reconciliation procedures.

## Validation

CI runs `terraform fmt -check`, initializes both environments with `-backend=false`, and runs `terraform validate`. It does not contact AWS or apply infrastructure.
