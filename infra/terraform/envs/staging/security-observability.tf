resource "aws_wafv2_web_acl" "application" {
  count = var.enable_waf ? 1 : 0

  name  = local.name
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-common-rule-set"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 20

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 30

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = local.name
    sampled_requests_enabled   = true
  }

  tags = local.common_tags
}

resource "aws_wafv2_web_acl_association" "application" {
  count = var.enable_waf ? 1 : 0

  resource_arn = aws_lb.application.arn
  web_acl_arn  = aws_wafv2_web_acl.application[0].arn
}

resource "aws_cloudwatch_log_group" "waf" {
  count = var.enable_waf ? 1 : 0

  name              = "aws-waf-logs-${local.name}"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

resource "aws_wafv2_web_acl_logging_configuration" "application" {
  count = var.enable_waf ? 1 : 0

  resource_arn            = aws_wafv2_web_acl.application[0].arn
  log_destination_configs = ["${aws_cloudwatch_log_group.waf[0].arn}:*"]
}

resource "aws_sns_topic" "operations" {
  name              = "${local.name}-operations"
  kms_master_key_id = "alias/aws/sns"
  tags              = local.common_tags
}

resource "aws_sns_topic_subscription" "email" {
  count = var.alert_email != "" ? 1 : 0

  topic_arn = aws_sns_topic.operations.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.name}-alb-5xx"
  alarm_description   = "The public load balancer is returning elevated 5xx responses."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.application.arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operations.arn]
  ok_actions          = [aws_sns_topic.operations.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "api_unhealthy" {
  alarm_name        = "${local.name}-api-unhealthy-hosts"
  alarm_description = "One or more API targets are unhealthy."
  namespace         = "AWS/ApplicationELB"
  metric_name       = "UnHealthyHostCount"
  dimensions = {
    LoadBalancer = aws_lb.application.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = var.deploy_services ? "breaching" : "notBreaching"
  alarm_actions       = [aws_sns_topic.operations.arn]
  ok_actions          = [aws_sns_topic.operations.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "web_unhealthy" {
  alarm_name        = "${local.name}-web-unhealthy-hosts"
  alarm_description = "One or more dashboard targets are unhealthy."
  namespace         = "AWS/ApplicationELB"
  metric_name       = "UnHealthyHostCount"
  dimensions = {
    LoadBalancer = aws_lb.application.arn_suffix
    TargetGroup  = aws_lb_target_group.web.arn_suffix
  }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = var.deploy_services ? "breaching" : "notBreaching"
  alarm_actions       = [aws_sns_topic.operations.arn]
  ok_actions          = [aws_sns_topic.operations.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_log_metric_filter" "api_errors" {
  name           = "${local.name}-api-errors"
  pattern        = "{ $.level = \"error\" }"
  log_group_name = aws_cloudwatch_log_group.service["api"].name

  metric_transformation {
    name      = "ApiErrorCount"
    namespace = "PaymentOps/${var.environment}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "${local.name}-api-errors"
  alarm_description   = "The API is emitting repeated structured error logs."
  namespace           = "PaymentOps/${var.environment}"
  metric_name         = "ApiErrorCount"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operations.arn]
  ok_actions          = [aws_sns_topic.operations.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_dashboard" "operations" {
  dashboard_name = "${local.name}-operations"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "ALB traffic and errors"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.application.arn_suffix],
            [".", "HTTPCode_ELB_5XX_Count", ".", "."],
            [".", "HTTPCode_Target_5XX_Count", ".", "."]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Target response time"
          region = var.aws_region
          stat   = "p95"
          period = 300
          metrics = [
            [
              "AWS/ApplicationELB",
              "TargetResponseTime",
              "LoadBalancer",
              aws_lb.application.arn_suffix
            ]
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "API application errors"
          region = var.aws_region
          stat   = "Sum"
          period = 300
          metrics = [
            ["PaymentOps/${var.environment}", "ApiErrorCount"]
          ]
        }
      },
      {
        type   = "log"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Recent API errors"
          region = var.aws_region
          query  = "SOURCE '${aws_cloudwatch_log_group.service["api"].name}' | fields @timestamp, level, message, correlationId | filter level = \"error\" | sort @timestamp desc | limit 50"
          view   = "table"
        }
      }
    ]
  })
}