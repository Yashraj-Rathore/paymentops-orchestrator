# SQL Server Module

Creates a private, encrypted RDS for SQL Server Express instance, generated administrator credentials, and a recoverable Secrets Manager secret containing the complete `DATABASE_URL`.

Automated backups default to seven days, deletion protection is enabled, changes use the maintenance window, and destruction creates a final snapshot by default. Set `deletion_protection=false` only during an intentional teardown, and keep `skip_final_snapshot=false` unless a verified replacement snapshot already exists.

The module remains staging-oriented. A production deployment should use larger sizing, managed Redis and streaming services, cross-account backup copies, and a separately tested disaster-recovery region.
