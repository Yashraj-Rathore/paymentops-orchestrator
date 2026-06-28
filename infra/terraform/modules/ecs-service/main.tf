locals {
  container_definition = merge(
    {
      name      = var.name
      image     = var.image
      essential = true
      command   = var.command
      environment = [
        for key in sort(keys(var.environment_variables)) : {
          name  = key
          value = var.environment_variables[key]
        }
      ]
      secrets = [
        for key in sort(keys(var.secrets)) : {
          name      = key
          valueFrom = var.secrets[key]
        }
      ]
      portMappings = var.container_port == null ? [] : [
        {
          name          = var.port_name
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
          appProtocol   = "http"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = var.log_group_name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = var.name
        }
      }
    },
    var.health_check_command == null ? {} : {
      healthCheck = {
        command     = var.health_check_command
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  )
}

resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = var.task_execution_role_arn
  task_role_arn            = var.task_role_arn
  container_definitions    = jsonencode([local.container_definition])

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  tags = var.tags
}

resource "aws_ecs_service" "this" {
  name                   = var.name
  cluster                = var.cluster_arn
  task_definition        = aws_ecs_task_definition.this.arn
  desired_count          = var.desired_count
  enable_execute_command = var.enable_execute_command
  platform_version       = "LATEST"

  capacity_provider_strategy {
    capacity_provider = var.capacity_provider
    weight            = 1
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = var.assign_public_ip
  }

  dynamic "load_balancer" {
    for_each = var.target_group_arn == null ? [] : [var.target_group_arn]

    content {
      target_group_arn = load_balancer.value
      container_name   = var.name
      container_port   = var.container_port
    }
  }

  dynamic "service_connect_configuration" {
    for_each = var.service_connect_namespace_arn == null ? [] : [1]

    content {
      enabled   = true
      namespace = var.service_connect_namespace_arn

      dynamic "service" {
        for_each = var.service_connect_dns_name == null ? [] : [1]

        content {
          port_name = var.port_name

          client_alias {
            dns_name = var.service_connect_dns_name
            port     = coalesce(var.service_connect_port, var.container_port)
          }
        }
      }
    }
  }

  health_check_grace_period_seconds = var.target_group_arn == null ? null : var.health_check_grace_period_seconds

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  tags = var.tags
}
