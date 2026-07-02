locals {
  name = "${var.project_name}-${var.environment}"
  common_tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )

  application_image   = var.container_image != "" ? var.container_image : "${aws_ecr_repository.application.repository_url}:${var.image_tag}"
  capacity_provider   = var.use_fargate_spot ? "FARGATE_SPOT" : "FARGATE"
  database_secret_arn = var.create_database ? module.sql_server[0].database_url_secret_arn : var.database_url_secret_arn
  certificate_arn     = var.create_certificate ? aws_acm_certificate_validation.application[0].certificate_arn : var.certificate_arn
  public_host         = var.domain_name != "" ? var.domain_name : aws_lb.application.dns_name
  public_url          = "${var.enable_https ? "https" : "http"}://${local.public_host}"
  service_names = toset([
    "api",
    "web",
    "worker",
    "provider-simulator",
    "otel-collector",
    "redis",
    "redpanda",
  ])
}