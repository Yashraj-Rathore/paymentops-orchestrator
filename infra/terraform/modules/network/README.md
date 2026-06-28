# Network Module

Creates a DNS-enabled VPC, internet gateway, public and isolated private subnets across two or three availability zones, and their route tables. Public subnets host the ALB and low-cost staging Fargate tasks; private subnets are reserved for SQL Server.