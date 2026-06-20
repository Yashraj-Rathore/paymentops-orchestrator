variable "environment" {
  type        = string
  description = "Deployment environment name."
}

output "name" {
  value = "paymentops-${var.environment}"
}
