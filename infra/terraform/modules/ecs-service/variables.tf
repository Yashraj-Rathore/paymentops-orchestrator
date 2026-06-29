variable "name" {
  type        = string
  description = "ECS service, task family, and container name."
}

variable "cluster_arn" {
  type        = string
  description = "ECS cluster ARN."
}

variable "image" {
  type        = string
  description = "Container image URI."
}

variable "command" {
  type        = list(string)
  description = "Container command override."
  default     = []
}

variable "cpu" {
  type        = number
  description = "Fargate task CPU units."
  default     = 256
}

variable "memory" {
  type        = number
  description = "Fargate task memory in MiB."
  default     = 512
}

variable "desired_count" {
  type        = number
  description = "Desired ECS task count."
  default     = 1
}

variable "task_execution_role_arn" {
  type        = string
  description = "IAM role ARN used by ECS to pull images, write logs, and resolve secrets."
}

variable "task_role_arn" {
  type        = string
  description = "IAM role ARN exposed to the running container."
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnet identifiers used by the ECS service."
}

variable "security_group_ids" {
  type        = list(string)
  description = "Security groups attached to Fargate task ENIs."
}

variable "assign_public_ip" {
  type        = bool
  description = "Assign public IP addresses to Fargate tasks."
  default     = true
}

variable "container_port" {
  type        = number
  description = "Optional container port exposed by the service."
  default     = null
  nullable    = true
}

variable "port_name" {
  type        = string
  description = "Named port used by ECS Service Connect."
  default     = "http"
}

variable "app_protocol" {
  type        = string
  description = "Optional ECS app protocol for the named port."
  default     = "http"
  nullable    = true

  validation {
    condition     = var.app_protocol == null || contains(["http", "http2", "grpc"], var.app_protocol)
    error_message = "app_protocol must be null, http, http2, or grpc."
  }
}

variable "environment_variables" {
  type        = map(string)
  description = "Plaintext environment variables injected into the container."
  default     = {}
}

variable "secrets" {
  type        = map(string)
  description = "Environment variable names mapped to Secrets Manager or SSM parameter ARNs."
  default     = {}
}

variable "log_group_name" {
  type        = string
  description = "CloudWatch log group name."
}

variable "aws_region" {
  type        = string
  description = "AWS region used by the awslogs driver."
}

variable "target_group_arn" {
  type        = string
  description = "Optional ALB target group ARN."
  default     = null
  nullable    = true
}

variable "health_check_command" {
  type        = list(string)
  description = "Optional ECS container health check command."
  default     = null
  nullable    = true
}

variable "health_check_grace_period_seconds" {
  type        = number
  description = "Grace period before ALB health checks affect the service."
  default     = 60
}

variable "service_connect_namespace_arn" {
  type        = string
  description = "Optional ECS Service Connect namespace ARN."
  default     = null
  nullable    = true
}

variable "service_connect_dns_name" {
  type        = string
  description = "Optional Service Connect DNS alias exposed by this service."
  default     = null
  nullable    = true
}

variable "service_connect_port" {
  type        = number
  description = "Optional Service Connect client alias port."
  default     = null
  nullable    = true
}

variable "capacity_provider" {
  type        = string
  description = "Fargate capacity provider used by the ECS service."
  default     = "FARGATE_SPOT"

  validation {
    condition     = contains(["FARGATE", "FARGATE_SPOT"], var.capacity_provider)
    error_message = "capacity_provider must be FARGATE or FARGATE_SPOT."
  }
}

variable "enable_execute_command" {
  type        = bool
  description = "Enable ECS Exec for staging diagnostics."
  default     = true
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to ECS resources."
  default     = {}
}
