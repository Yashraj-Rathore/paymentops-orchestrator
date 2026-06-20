export interface SqlMigration {
  version: string;
  name: string;
  sql: string;
}

export const sqlMigrations: SqlMigration[] = [
  {
    version: "001",
    name: "persistence_baseline",
    sql: `
IF OBJECT_ID(N'dbo.tenants', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.tenants (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_tenants PRIMARY KEY DEFAULT NEWID(),
    external_id NVARCHAR(64) NOT NULL CONSTRAINT uq_tenants_external_id UNIQUE,
    name NVARCHAR(200) NOT NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT df_tenants_status DEFAULT N'active',
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_tenants_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_tenants_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ck_tenants_status CHECK (status IN (N'active', N'suspended', N'archived'))
  );
END;

IF OBJECT_ID(N'dbo.user_memberships', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_memberships (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_user_memberships PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    user_email NVARCHAR(256) NOT NULL,
    role NVARCHAR(64) NOT NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT df_user_memberships_status DEFAULT N'active',
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_user_memberships_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_user_memberships_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_user_memberships_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT uq_user_memberships_tenant_email UNIQUE (tenant_id, user_email),
    CONSTRAINT ck_user_memberships_status CHECK (status IN (N'active', N'invited', N'disabled'))
  );
END;

IF OBJECT_ID(N'dbo.api_clients', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.api_clients (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_api_clients PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    external_id NVARCHAR(64) NOT NULL CONSTRAINT uq_api_clients_external_id UNIQUE,
    name NVARCHAR(200) NOT NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT df_api_clients_status DEFAULT N'active',
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_api_clients_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_api_clients_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_api_clients_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT ck_api_clients_status CHECK (status IN (N'active', N'disabled'))
  );

  CREATE INDEX ix_api_clients_tenant_id ON dbo.api_clients (tenant_id, created_at DESC);
END;

IF OBJECT_ID(N'dbo.api_keys', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.api_keys (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_api_keys PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    api_client_id UNIQUEIDENTIFIER NOT NULL,
    external_id NVARCHAR(64) NOT NULL CONSTRAINT uq_api_keys_external_id UNIQUE,
    name NVARCHAR(200) NOT NULL,
    key_hash NVARCHAR(128) NOT NULL CONSTRAINT uq_api_keys_hash UNIQUE,
    key_prefix NVARCHAR(32) NOT NULL,
    permissions_json NVARCHAR(MAX) NOT NULL,
    expires_at DATETIME2(3) NULL,
    revoked_at DATETIME2(3) NULL,
    last_used_at DATETIME2(3) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_api_keys_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_api_keys_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT fk_api_keys_client FOREIGN KEY (api_client_id) REFERENCES dbo.api_clients(id),
    CONSTRAINT ck_api_keys_permissions_json CHECK (ISJSON(permissions_json) = 1)
  );

  CREATE INDEX ix_api_keys_tenant_client ON dbo.api_keys (tenant_id, api_client_id, created_at DESC);
END;

IF OBJECT_ID(N'dbo.webhook_endpoints', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.webhook_endpoints (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_webhook_endpoints PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    external_id NVARCHAR(64) NOT NULL CONSTRAINT uq_webhook_endpoints_external_id UNIQUE,
    url NVARCHAR(2048) NOT NULL,
    description NVARCHAR(500) NULL,
    secret_hash NVARCHAR(128) NOT NULL,
    event_subscriptions_json NVARCHAR(MAX) NOT NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT df_webhook_endpoints_status DEFAULT N'active',
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_webhook_endpoints_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_webhook_endpoints_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_webhook_endpoints_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT ck_webhook_endpoints_status CHECK (status IN (N'active', N'disabled')),
    CONSTRAINT ck_webhook_endpoints_events_json CHECK (ISJSON(event_subscriptions_json) = 1)
  );

  CREATE INDEX ix_webhook_endpoints_tenant_id ON dbo.webhook_endpoints (tenant_id, created_at DESC);
END;

IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.audit_logs (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_audit_logs PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NULL,
    actor_type NVARCHAR(64) NOT NULL,
    actor_id NVARCHAR(256) NOT NULL,
    action NVARCHAR(128) NOT NULL,
    resource_type NVARCHAR(128) NOT NULL,
    resource_id NVARCHAR(128) NOT NULL,
    metadata_json NVARCHAR(MAX) NOT NULL CONSTRAINT df_audit_logs_metadata DEFAULT N'{}',
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_audit_logs_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_audit_logs_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT ck_audit_logs_metadata_json CHECK (ISJSON(metadata_json) = 1)
  );

  CREATE INDEX ix_audit_logs_tenant_created_at ON dbo.audit_logs (tenant_id, created_at DESC);
END;
`
  }
];