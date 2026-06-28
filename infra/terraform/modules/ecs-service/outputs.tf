output "service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.this.name
}

output "task_definition_arn" {
  description = "Active task definition ARN."
  value       = aws_ecs_task_definition.this.arn
}
