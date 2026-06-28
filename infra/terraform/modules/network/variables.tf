variable "project_name" {
  type        = string
  description = "Project name used for AWS resource naming."
  default     = "paymentops"
}

variable "environment" {
  type        = string
  description = "Deployment environment name."
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block allocated to the environment VPC."
  default     = "10.42.0.0/16"
}

variable "availability_zone_count" {
  type        = number
  description = "Number of availability zones used for public and private subnets."
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 3
    error_message = "availability_zone_count must be between 2 and 3."
  }
}

variable "tags" {
  type        = map(string)
  description = "Additional tags applied to network resources."
  default     = {}
}
