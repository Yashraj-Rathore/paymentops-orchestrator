data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${local.name}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "task_secrets" {
  statement {
    sid     = "ReadApplicationSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = local.database_secret_arn != "" ? [local.database_secret_arn] : [
      "arn:aws:secretsmanager:${var.aws_region}:*:secret:${local.name}/*",
    ]
  }
}

resource "aws_iam_role_policy" "task_secrets" {
  name   = "read-application-secrets"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.task_secrets.json
}

resource "aws_iam_role" "application_task" {
  name               = "${local.name}-application-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "xray" {
  role       = aws_iam_role.application_task.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "cloudwatch_agent" {
  role       = aws_iam_role.application_task.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}