output "name" {
  description = "Environment network name."
  value       = local.name
}

output "vpc_id" {
  description = "VPC identifier."
  value       = aws_vpc.this.id
}

output "public_subnet_ids" {
  description = "Public subnet identifiers used by the ALB and staging Fargate tasks."
  value       = values(aws_subnet.public)[*].id
}

output "private_subnet_ids" {
  description = "Isolated private subnet identifiers used by SQL Server."
  value       = values(aws_subnet.private)[*].id
}

output "availability_zones" {
  description = "Availability zones selected by the module."
  value       = local.availability_zones
}
