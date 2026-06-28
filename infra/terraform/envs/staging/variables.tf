variable "aws_region" {
  type        = string
  description = "AWS region for the staging environment."
  default     = "ca-central-1"
}

variable "project_name" {
  type        = string
  description = "Name prefix used for AWS resources."
  default     = "paymentops"
}

variable "environment" {
  type        = string
  description = "Deployment environment name."
  default     = "staging"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR assigned to the staging VPC."
  default     = "10.42.0.0/16"
}

variable "deploy_services" {
  type        = bool
  description = "Deploy ECS services after an application image is available."
  default     = false
}

variable "container_image" {
  type        = string
  description = "Optional full application image URI. Defaults to the managed ECR repository."
  default     = ""
}

variable "image_tag" {
  type        = string
  description = "Tag used when container_image is not supplied."
  default     = "latest"
}

variable "create_database" {
  type        = bool
  description = "Create a private RDS for SQL Server Express instance."
  default     = false
}

variable "database_url_secret_arn" {
  type        = string
  description = "Existing Secrets Manager ARN containing DATABASE_URL when RDS creation is disabled."
  default     = ""
}

variable "auth0_domain" {
  type        = string
  description = "Auth0 issuer domain used by the API."
  default     = "paymentops-dev.us.auth0.com"
}

variable "auth0_audience" {
  type        = string
  description = "Auth0 API audience."
  default     = "https://api.paymentops.local"
}

variable "auth0_role_claim" {
  type        = string
  description = "JWT claim containing PaymentOps roles."
  default     = "https://paymentops.local/roles"
}

variable "use_fargate_spot" {
  type        = bool
  description = "Run staging services on Fargate Spot capacity."
  default     = true
}

variable "desired_count" {
  type        = number
  description = "Desired task count for each service."
  default     = 1
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention."
  default     = 14
}

variable "otel_collector_image" {
  type        = string
  description = "AWS Distro for OpenTelemetry collector image."
  default     = "public.ecr.aws/aws-observability/aws-otel-collector:latest"
}

variable "tags" {
  type        = map(string)
  description = "Additional tags applied to resources."
  default     = {}
}