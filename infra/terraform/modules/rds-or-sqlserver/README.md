# SQL Server Module

Creates a private RDS for SQL Server Express instance, generated administrator credentials, and a Secrets Manager secret containing the complete `DATABASE_URL`. The module is intended for staging only; production settings require stronger retention, backups, deletion protection, and sizing.