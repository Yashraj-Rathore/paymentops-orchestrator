# AWS Staging Infrastructure

Terraform provisions a no-apply staging baseline for PaymentOps Orchestrator in `ca-central-1`:

- A DNS-enabled VPC spanning two availability zones
- Public subnets for the Application Load Balancer and Fargate tasks
- Isolated private subnets for optional RDS for SQL Server Express
- ECR, ECS/Fargate, Service Connect, CloudWatch Logs, and task IAM roles
- API, web, worker, provider simulator, single-node Redis and Redpanda, and AWS Distro for OpenTelemetry services
- Secrets Manager injection of `DATABASE_URL`

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

The load balancer is HTTP-only for this staging baseline. Add a validated ACM certificate, HTTPS listener, DNS record, WAF policy, and tighter ingress before exposing a production environment.

## Validation

CI runs `terraform fmt -check`, initializes both environments with `-backend=false`, and runs `terraform validate`. It does not contact AWS or apply infrastructure.