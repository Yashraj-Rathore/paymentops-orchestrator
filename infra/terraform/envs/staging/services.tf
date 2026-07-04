module "redis" {
  count  = var.deploy_services ? 1 : 0
  source = "../../modules/ecs-service"

  name                          = "${local.name}-redis"
  cluster_arn                   = aws_ecs_cluster.this.arn
  image                         = "redis:7-alpine"
  command                       = ["redis-server", "--appendonly", "yes"]
  cpu                           = 256
  memory                        = 512
  desired_count                 = 1
  task_execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn                 = aws_iam_role.application_task.arn
  subnet_ids                    = module.network.public_subnet_ids
  security_group_ids            = [aws_security_group.ecs.id]
  container_port                = 6379
  port_name                     = "redis-tcp"
  app_protocol                  = null
  log_group_name                = aws_cloudwatch_log_group.service["redis"].name
  aws_region                    = var.aws_region
  health_check_command          = ["CMD-SHELL", "redis-cli ping | grep -q PONG"]
  service_connect_namespace_arn = aws_service_discovery_http_namespace.this.arn
  service_connect_dns_name      = "redis"
  service_connect_port          = 6379
  capacity_provider             = local.capacity_provider
  tags                          = local.common_tags

  depends_on = [terraform_data.deployment_guard]
}

module "redpanda" {
  count  = var.deploy_services ? 1 : 0
  source = "../../modules/ecs-service"

  name        = "${local.name}-redpanda"
  cluster_arn = aws_ecs_cluster.this.arn
  image       = "docker.redpanda.com/redpandadata/redpanda:v24.2.7"
  command = [
    "redpanda", "start",
    "--overprovisioned",
    "--smp", "1",
    "--memory", "1G",
    "--reserve-memory", "0M",
    "--node-id", "0",
    "--check=false",
    "--kafka-addr", "PLAINTEXT://0.0.0.0:9092",
    "--advertise-kafka-addr", "PLAINTEXT://redpanda:9092"
  ]
  cpu                           = 512
  memory                        = 2048
  desired_count                 = 1
  task_execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn                 = aws_iam_role.application_task.arn
  subnet_ids                    = module.network.public_subnet_ids
  security_group_ids            = [aws_security_group.ecs.id]
  container_port                = 9092
  port_name                     = "kafka-tcp"
  app_protocol                  = null
  log_group_name                = aws_cloudwatch_log_group.service["redpanda"].name
  aws_region                    = var.aws_region
  health_check_command          = ["CMD-SHELL", "rpk cluster health | grep -q 'Healthy:.*true'"]
  service_connect_namespace_arn = aws_service_discovery_http_namespace.this.arn
  service_connect_dns_name      = "redpanda"
  service_connect_port          = 9092
  capacity_provider             = local.capacity_provider
  tags                          = local.common_tags

  depends_on = [terraform_data.deployment_guard]
}
module "otel_collector" {
  count  = var.deploy_services ? 1 : 0
  source = "../../modules/ecs-service"

  name                          = "${local.name}-otel-collector"
  cluster_arn                   = aws_ecs_cluster.this.arn
  image                         = var.otel_collector_image
  command                       = ["--config=/etc/ecs/ecs-default-config.yaml"]
  cpu                           = 256
  memory                        = 512
  desired_count                 = var.desired_count
  task_execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn                 = aws_iam_role.application_task.arn
  subnet_ids                    = module.network.public_subnet_ids
  security_group_ids            = [aws_security_group.ecs.id]
  container_port                = 4318
  port_name                     = "otlp-http"
  log_group_name                = aws_cloudwatch_log_group.service["otel-collector"].name
  aws_region                    = var.aws_region
  service_connect_namespace_arn = aws_service_discovery_http_namespace.this.arn
  service_connect_dns_name      = "otel-collector"
  service_connect_port          = 4318
  capacity_provider             = local.capacity_provider
  tags                          = local.common_tags

  depends_on = [terraform_data.deployment_guard]
}

module "api" {
  count  = var.deploy_services ? 1 : 0
  source = "../../modules/ecs-service"

  name                    = "${local.name}-api"
  cluster_arn             = aws_ecs_cluster.this.arn
  image                   = local.application_image
  command                 = ["node", "apps/api/dist/main.js"]
  cpu                     = 512
  memory                  = 1024
  desired_count           = var.desired_count
  task_execution_role_arn = aws_iam_role.task_execution.arn
  task_role_arn           = aws_iam_role.application_task.arn
  subnet_ids              = module.network.public_subnet_ids
  security_group_ids      = [aws_security_group.ecs.id]
  container_port          = 3000
  port_name               = "api-http"
  environment_variables = {
    NODE_ENV                    = "production"
    API_PORT                    = "3000"
    AUTH_MODE                   = "auth0"
    AUTH0_DOMAIN                = var.auth0_domain
    AUTH0_AUDIENCE              = var.auth0_audience
    AUTH0_ROLE_CLAIM            = var.auth0_role_claim
    CORS_ORIGINS                = local.public_url
    OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4318"
    PROVIDER_SIMULATOR_URL      = "http://provider-simulator:3003"
    PAYMENTOPS_API_INTERNAL_URL = "http://api:3000"
  }
  secrets = {
    DATABASE_URL = local.database_secret_arn
  }
  log_group_name                = aws_cloudwatch_log_group.service["api"].name
  aws_region                    = var.aws_region
  target_group_arn              = aws_lb_target_group.api.arn
  health_check_command          = ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""]
  service_connect_namespace_arn = aws_service_discovery_http_namespace.this.arn
  service_connect_dns_name      = "api"
  service_connect_port          = 3000
  capacity_provider             = local.capacity_provider
  tags                          = local.common_tags

  depends_on = [aws_lb_listener_rule.api, module.otel_collector, terraform_data.deployment_guard]
}

module "provider_simulator" {
  count  = var.deploy_services ? 1 : 0
  source = "../../modules/ecs-service"

  name                    = "${local.name}-provider-simulator"
  cluster_arn             = aws_ecs_cluster.this.arn
  image                   = local.application_image
  command                 = ["node", "apps/provider-simulator/dist/main.js"]
  cpu                     = 256
  memory                  = 512
  desired_count           = var.desired_count
  task_execution_role_arn = aws_iam_role.task_execution.arn
  task_role_arn           = aws_iam_role.application_task.arn
  subnet_ids              = module.network.public_subnet_ids
  security_group_ids      = [aws_security_group.ecs.id]
  container_port          = 3003
  port_name               = "provider-http"
  environment_variables = {
    NODE_ENV                    = "production"
    PROVIDER_SIMULATOR_PORT     = "3003"
    OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4318"
  }
  log_group_name                = aws_cloudwatch_log_group.service["provider-simulator"].name
  aws_region                    = var.aws_region
  health_check_command          = ["CMD-SHELL", "node -e \"fetch('http://localhost:3003/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""]
  service_connect_namespace_arn = aws_service_discovery_http_namespace.this.arn
  service_connect_dns_name      = "provider-simulator"
  service_connect_port          = 3003
  capacity_provider             = local.capacity_provider
  tags                          = local.common_tags

  depends_on = [module.otel_collector, terraform_data.deployment_guard]
}

module "worker" {
  count  = var.deploy_services ? 1 : 0
  source = "../../modules/ecs-service"

  name                    = "${local.name}-worker"
  cluster_arn             = aws_ecs_cluster.this.arn
  image                   = local.application_image
  command                 = ["node", "apps/worker/dist/main.js"]
  cpu                     = 256
  memory                  = 512
  desired_count           = var.desired_count
  task_execution_role_arn = aws_iam_role.task_execution.arn
  task_role_arn           = aws_iam_role.application_task.arn
  subnet_ids              = module.network.public_subnet_ids
  security_group_ids      = [aws_security_group.ecs.id]
  environment_variables = {
    NODE_ENV                    = "production"
    REDIS_URL                   = "redis://redis:6379"
    REDPANDA_BROKERS            = "redpanda:9092"
    OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4318"
    PROVIDER_SIMULATOR_URL      = "http://provider-simulator:3003"
    PAYMENTOPS_API_INTERNAL_URL = "http://api:3000"
  }
  secrets = {
    DATABASE_URL = local.database_secret_arn
  }
  log_group_name                = aws_cloudwatch_log_group.service["worker"].name
  aws_region                    = var.aws_region
  service_connect_namespace_arn = aws_service_discovery_http_namespace.this.arn
  capacity_provider             = local.capacity_provider
  tags                          = local.common_tags

  depends_on = [module.api, module.provider_simulator, module.redis, module.redpanda, terraform_data.deployment_guard]
}

module "web" {
  count  = var.deploy_services ? 1 : 0
  source = "../../modules/ecs-service"

  name                    = "${local.name}-web"
  cluster_arn             = aws_ecs_cluster.this.arn
  image                   = local.application_image
  command                 = ["node", "apps/web/.output/server/index.mjs"]
  cpu                     = 256
  memory                  = 512
  desired_count           = var.desired_count
  task_execution_role_arn = aws_iam_role.task_execution.arn
  task_role_arn           = aws_iam_role.application_task.arn
  subnet_ids              = module.network.public_subnet_ids
  security_group_ids      = [aws_security_group.ecs.id]
  container_port          = 3001
  port_name               = "web-http"
  environment_variables = {
    NODE_ENV                    = "production"
    NITRO_HOST                  = "0.0.0.0"
    NITRO_PORT                  = "3001"
    NUXT_PUBLIC_API_BASE_URL    = local.public_url
    NUXT_PUBLIC_DEV_ADMIN_TOKEN = ""
    NUXT_PUBLIC_AUTH_MODE       = "auth0"
    NUXT_PUBLIC_AUTH0_DOMAIN    = var.auth0_domain
    NUXT_PUBLIC_AUTH0_CLIENT_ID = var.auth0_client_id
    NUXT_PUBLIC_AUTH0_AUDIENCE  = var.auth0_audience
  }
  log_group_name       = aws_cloudwatch_log_group.service["web"].name
  aws_region           = var.aws_region
  target_group_arn     = aws_lb_target_group.web.arn
  health_check_command = ["CMD-SHELL", "node -e \"fetch('http://localhost:3001/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""]
  capacity_provider    = local.capacity_provider
  tags                 = local.common_tags

  depends_on = [aws_lb_listener_rule.api, module.api, terraform_data.deployment_guard]
}
