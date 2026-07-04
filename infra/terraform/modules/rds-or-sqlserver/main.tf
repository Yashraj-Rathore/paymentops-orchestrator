terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
    random = {
      source = "hashicorp/random"
    }
  }
}

resource "random_password" "master" {
  length           = 32
  special          = true
  override_special = "!#$%&*+-=?_"
}

resource "random_id" "final_snapshot" {
  byte_length = 4
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_db_instance" "this" {
  identifier                   = var.name
  engine                       = "sqlserver-ex"
  license_model                = "license-included"
  instance_class               = var.instance_class
  allocated_storage            = var.allocated_storage
  max_allocated_storage        = var.max_allocated_storage
  storage_type                 = "gp3"
  storage_encrypted            = true
  username                     = var.username
  password                     = random_password.master.result
  port                         = 1433
  db_subnet_group_name         = aws_db_subnet_group.this.name
  vpc_security_group_ids       = var.security_group_ids
  publicly_accessible          = false
  multi_az                     = false
  backup_retention_period      = var.backup_retention_period
  backup_window                = "03:00-04:00"
  maintenance_window           = "sun:04:00-sun:05:00"
  copy_tags_to_snapshot        = true
  deletion_protection          = var.deletion_protection
  skip_final_snapshot          = var.skip_final_snapshot
  final_snapshot_identifier    = var.skip_final_snapshot ? null : "${var.name}-final-${random_id.final_snapshot.hex}"
  auto_minor_version_upgrade   = true
  performance_insights_enabled = false
  apply_immediately            = false

  tags = var.tags
}

resource "aws_secretsmanager_secret" "database_url" {
  name_prefix             = "${var.name}/database-url-"
  recovery_window_in_days = var.secret_recovery_window_in_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "sqlserver://%s:%s@%s:%d;database=%s;encrypt=true;trustServerCertificate=false",
    var.username,
    urlencode(random_password.master.result),
    aws_db_instance.this.address,
    aws_db_instance.this.port,
    var.database_name
  )
}
