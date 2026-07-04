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

    precondition {
      condition = !var.enable_https || (
        var.certificate_arn != "" ||
        (var.create_certificate && var.domain_name != "" && var.route53_zone_id != "")
      )
      error_message = "HTTPS requires certificate_arn or create_certificate=true with domain_name and route53_zone_id."
    }

    precondition {
      condition     = var.domain_name == "" || var.route53_zone_id != ""
      error_message = "route53_zone_id is required when domain_name is set."
    }

    precondition {
      condition = !var.deploy_services || (
        var.auth0_client_id != "" &&
        !strcontains(var.auth0_domain, "paymentops-dev") &&
        !strcontains(var.auth0_domain, "your-tenant") &&
        !strcontains(var.auth0_audience, "paymentops.local")
      )
      error_message = "Service deployment requires real Auth0 domain, client ID, and API audience values."
    }

    precondition {
      condition = !var.deploy_services || (
        var.container_image != "" ||
        (trimspace(var.image_tag) != "" && var.image_tag != "latest")
      )
      error_message = "Service deployment requires an immutable image tag or explicit container_image."
    }
  }
}
