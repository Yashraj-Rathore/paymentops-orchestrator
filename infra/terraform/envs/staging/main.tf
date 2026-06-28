module "network" {
  source = "../../modules/network"

  project_name = var.project_name
  environment  = var.environment
  vpc_cidr     = var.vpc_cidr
  tags         = var.tags
}

resource "aws_ecs_cluster" "this" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

resource "aws_service_discovery_http_namespace" "this" {
  name        = local.name
  description = "Service Connect namespace for ${local.name}"
  tags        = local.common_tags
}

resource "terraform_data" "deployment_guard" {
  lifecycle {
    precondition {
      condition     = !var.deploy_services || var.create_database || var.database_url_secret_arn != ""
      error_message = "Set create_database=true or database_url_secret_arn before deploy_services=true."
    }
  }
}