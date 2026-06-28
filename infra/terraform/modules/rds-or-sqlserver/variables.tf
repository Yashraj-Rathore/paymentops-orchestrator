variable "name" {
  type        = string
  description = "Name prefix for SQL Server resources."
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet identifiers used by the DB subnet group."
}

variable "security_group_ids" {
  type        = list(string)
  description = "Security groups attached to SQL Server."
}

variable "instance_class" {
  type        = string
  description = "RDS SQL Server instance class."
  default     = "db.t3.small"
}

variable "allocated_storage" {
  type        = number
  description = "Initial SQL Server storage allocation in GiB."
  default     = 20
}

variable "max_allocated_storage" {
  type        = number
  description = "Maximum storage autoscaling limit in GiB."
  default     = 100
}

variable "username" {
  type        = string
  description = "SQL Server master username."
  default     = "paymentopsadmin"
}

variable "database_name" {
  type        = string
  description = "Application database created by the API on startup."
  default     = "paymentops"
}

variable "deletion_protection" {
  type        = bool
  description = "Protect the staging database from accidental deletion."
  default     = false
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to SQL Server resources."
  default     = {}
}
