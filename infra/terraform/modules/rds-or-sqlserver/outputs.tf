output "database_url_secret_arn" {
  description = "Secrets Manager ARN containing the complete SQL Server connection URL."
  value       = aws_secretsmanager_secret.database_url.arn
}

output "endpoint" {
  description = "RDS SQL Server endpoint."
  value       = aws_db_instance.this.endpoint
}
