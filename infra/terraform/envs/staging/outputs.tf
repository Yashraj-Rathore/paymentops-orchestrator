output "environment" {
  value       = var.environment
  description = "Terraform environment name."
}

output "ecr_repository_url" {
  value       = aws_ecr_repository.application.repository_url
  description = "Push the workspace image to this ECR repository before enabling services."
}

output "public_url" {
  value       = local.public_url
  description = "Public staging URL backed by the ALB or configured Route 53 domain."
}

output "operations_alarm_topic_arn" {
  value       = aws_sns_topic.operations.arn
  description = "SNS topic receiving PaymentOps staging alarms."
}

output "cloudwatch_dashboard_name" {
  value       = aws_cloudwatch_dashboard.operations.dashboard_name
  description = "CloudWatch operations dashboard name."
}

output "ecs_cluster_name" {
  value       = aws_ecs_cluster.this.name
  description = "ECS cluster hosting PaymentOps services."
}

output "api_task_definition_arn" {
  value       = try(module.api[0].task_definition_arn, null)
  description = "API task definition; use it for a one-off database migration task."
}

output "public_subnet_ids" {
  value       = module.network.public_subnet_ids
  description = "Subnets used by ECS tasks."
}

output "ecs_security_group_id" {
  value       = aws_security_group.ecs.id
  description = "Security group used by ECS tasks."
}

output "database_url_secret_arn" {
  value       = local.database_secret_arn
  description = "Secrets Manager ARN consumed by API and worker task definitions."
}