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
  },
  {
    version: "002",
    name: "payout_core",
    sql: `
IF OBJECT_ID(N'dbo.payouts', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.payouts (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_payouts PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    external_id NVARCHAR(64) NOT NULL CONSTRAINT uq_payouts_external_id UNIQUE,
    amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL,
    destination_account NVARCHAR(256) NOT NULL,
    reference NVARCHAR(128) NULL,
    description NVARCHAR(500) NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT df_payouts_status DEFAULT N'queued',
    api_client_external_id NVARCHAR(64) NULL,
    api_key_external_id NVARCHAR(64) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_payouts_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_payouts_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_payouts_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT ck_payouts_amount_positive CHECK (amount_minor > 0),
    CONSTRAINT ck_payouts_currency CHECK (currency LIKE '[A-Z][A-Z][A-Z]'),
    CONSTRAINT ck_payouts_status CHECK (status IN (N'queued', N'processing', N'paid', N'failed', N'canceled', N'needs_approval'))
  );

  CREATE INDEX ix_payouts_tenant_created_at ON dbo.payouts (tenant_id, created_at DESC);
  CREATE INDEX ix_payouts_tenant_status ON dbo.payouts (tenant_id, status, created_at DESC);
END;

IF OBJECT_ID(N'dbo.payout_idempotency_keys', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.payout_idempotency_keys (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_payout_idempotency_keys PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    idempotency_key NVARCHAR(128) NOT NULL,
    request_hash NVARCHAR(128) NOT NULL,
    payout_id UNIQUEIDENTIFIER NOT NULL,
    response_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_payout_idempotency_keys_created_at DEFAULT SYSUTCDATETIME(),
    last_seen_at DATETIME2(3) NOT NULL CONSTRAINT df_payout_idempotency_keys_last_seen_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_payout_idempotency_keys_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT fk_payout_idempotency_keys_payout FOREIGN KEY (payout_id) REFERENCES dbo.payouts(id),
    CONSTRAINT uq_payout_idempotency_keys_tenant_key UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT ck_payout_idempotency_keys_response_json CHECK (ISJSON(response_json) = 1)
  );
END;

IF OBJECT_ID(N'dbo.ledger_entries', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ledger_entries (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ledger_entries PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    payout_id UNIQUEIDENTIFIER NOT NULL,
    external_id NVARCHAR(96) NOT NULL CONSTRAINT uq_ledger_entries_external_id UNIQUE,
    direction NVARCHAR(16) NOT NULL,
    account_name NVARCHAR(128) NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_ledger_entries_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_ledger_entries_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT fk_ledger_entries_payout FOREIGN KEY (payout_id) REFERENCES dbo.payouts(id),
    CONSTRAINT ck_ledger_entries_direction CHECK (direction IN (N'debit', N'credit')),
    CONSTRAINT ck_ledger_entries_amount_positive CHECK (amount_minor > 0),
    CONSTRAINT ck_ledger_entries_currency CHECK (currency LIKE '[A-Z][A-Z][A-Z]')
  );

  CREATE INDEX ix_ledger_entries_tenant_created_at ON dbo.ledger_entries (tenant_id, created_at DESC);
  CREATE INDEX ix_ledger_entries_payout_id ON dbo.ledger_entries (payout_id, id ASC);
END;

IF OBJECT_ID(N'dbo.payout_status_history', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.payout_status_history (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_payout_status_history PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    payout_id UNIQUEIDENTIFIER NOT NULL,
    from_status NVARCHAR(32) NULL,
    to_status NVARCHAR(32) NOT NULL,
    reason NVARCHAR(256) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_payout_status_history_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_payout_status_history_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT fk_payout_status_history_payout FOREIGN KEY (payout_id) REFERENCES dbo.payouts(id),
    CONSTRAINT ck_payout_status_history_from_status CHECK (from_status IS NULL OR from_status IN (N'queued', N'processing', N'paid', N'failed', N'canceled', N'needs_approval')),
    CONSTRAINT ck_payout_status_history_to_status CHECK (to_status IN (N'queued', N'processing', N'paid', N'failed', N'canceled', N'needs_approval'))
  );

  CREATE INDEX ix_payout_status_history_payout ON dbo.payout_status_history (payout_id, created_at ASC);
END;

IF OBJECT_ID(N'dbo.outbox_events', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.outbox_events (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_outbox_events PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    event_type NVARCHAR(128) NOT NULL,
    aggregate_type NVARCHAR(64) NOT NULL,
    aggregate_id NVARCHAR(64) NOT NULL,
    payload_json NVARCHAR(MAX) NOT NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT df_outbox_events_status DEFAULT N'pending',
    attempts INT NOT NULL CONSTRAINT df_outbox_events_attempts DEFAULT 0,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_outbox_events_created_at DEFAULT SYSUTCDATETIME(),
    published_at DATETIME2(3) NULL,
    CONSTRAINT fk_outbox_events_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT ck_outbox_events_status CHECK (status IN (N'pending', N'published', N'failed', N'dead_letter')),
    CONSTRAINT ck_outbox_events_payload_json CHECK (ISJSON(payload_json) = 1)
  );

  CREATE INDEX ix_outbox_events_status_created_at ON dbo.outbox_events (status, created_at ASC);
  CREATE INDEX ix_outbox_events_tenant_created_at ON dbo.outbox_events (tenant_id, created_at DESC);
END;
`
  },
  {
    version: "003",
    name: "async_payout_dispatch",
    sql: `
IF COL_LENGTH(N'dbo.payouts', N'provider_payout_id') IS NULL
BEGIN
  ALTER TABLE dbo.payouts ADD provider_payout_id NVARCHAR(128) NULL;
END;

IF COL_LENGTH(N'dbo.payouts', N'provider_reference') IS NULL
BEGIN
  ALTER TABLE dbo.payouts ADD provider_reference NVARCHAR(128) NULL;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'ix_payouts_provider_payout_id'
    AND object_id = OBJECT_ID(N'dbo.payouts')
)
BEGIN
  EXEC sp_executesql N'
    CREATE INDEX ix_payouts_provider_payout_id
      ON dbo.payouts (provider_payout_id)
      WHERE provider_payout_id IS NOT NULL;
  ';
END;
`
  },
  {
    version: "004",
    name: "merchant_webhook_deliveries",
    sql: `
IF COL_LENGTH(N'dbo.webhook_endpoints', N'signing_secret') IS NULL
BEGIN
  ALTER TABLE dbo.webhook_endpoints ADD signing_secret NVARCHAR(128) NULL;
END;

EXEC sp_executesql N'
  UPDATE dbo.webhook_endpoints
  SET signing_secret = CONCAT(N''whsec_seeded_'', external_id)
  WHERE signing_secret IS NULL;
';

IF OBJECT_ID(N'dbo.webhook_deliveries', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.webhook_deliveries (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_webhook_deliveries PRIMARY KEY DEFAULT NEWID(),
    external_id NVARCHAR(64) NOT NULL CONSTRAINT uq_webhook_deliveries_external_id UNIQUE,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    webhook_endpoint_id UNIQUEIDENTIFIER NOT NULL,
    outbox_event_id UNIQUEIDENTIFIER NOT NULL,
    event_type NVARCHAR(128) NOT NULL,
    aggregate_type NVARCHAR(64) NOT NULL,
    aggregate_id NVARCHAR(64) NOT NULL,
    payload_json NVARCHAR(MAX) NOT NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT df_webhook_deliveries_status DEFAULT N'pending',
    attempts INT NOT NULL CONSTRAINT df_webhook_deliveries_attempts DEFAULT 0,
    next_attempt_at DATETIME2(3) NULL CONSTRAINT df_webhook_deliveries_next_attempt_at DEFAULT SYSUTCDATETIME(),
    last_attempted_at DATETIME2(3) NULL,
    delivered_at DATETIME2(3) NULL,
    last_status_code INT NULL,
    last_error NVARCHAR(1000) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_webhook_deliveries_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_webhook_deliveries_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_webhook_deliveries_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT fk_webhook_deliveries_endpoint FOREIGN KEY (webhook_endpoint_id) REFERENCES dbo.webhook_endpoints(id),
    CONSTRAINT fk_webhook_deliveries_outbox_event FOREIGN KEY (outbox_event_id) REFERENCES dbo.outbox_events(id),
    CONSTRAINT uq_webhook_deliveries_endpoint_event UNIQUE (webhook_endpoint_id, outbox_event_id),
    CONSTRAINT ck_webhook_deliveries_status CHECK (status IN (N'pending', N'delivered', N'failed', N'dead_letter')),
    CONSTRAINT ck_webhook_deliveries_payload_json CHECK (ISJSON(payload_json) = 1)
  );

  CREATE INDEX ix_webhook_deliveries_status_next_attempt ON dbo.webhook_deliveries (status, next_attempt_at, created_at ASC);
  CREATE INDEX ix_webhook_deliveries_tenant_created_at ON dbo.webhook_deliveries (tenant_id, created_at DESC);
END;

IF OBJECT_ID(N'dbo.webhook_delivery_attempts', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.webhook_delivery_attempts (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_webhook_delivery_attempts PRIMARY KEY,
    webhook_delivery_id UNIQUEIDENTIFIER NOT NULL,
    attempt_number INT NOT NULL,
    status_code INT NULL,
    response_body NVARCHAR(2000) NULL,
    error_message NVARCHAR(1000) NULL,
    duration_ms INT NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_webhook_delivery_attempts_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_webhook_delivery_attempts_delivery FOREIGN KEY (webhook_delivery_id) REFERENCES dbo.webhook_deliveries(id)
  );

  CREATE INDEX ix_webhook_delivery_attempts_delivery ON dbo.webhook_delivery_attempts (webhook_delivery_id, attempt_number DESC);
END;
`
  },
  {
    version: "005",
    name: "risk_and_approval_workflow",
    sql: `
IF OBJECT_ID(N'dbo.risk_rules', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.risk_rules (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_risk_rules PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NULL,
    external_id NVARCHAR(64) NOT NULL CONSTRAINT uq_risk_rules_external_id UNIQUE,
    name NVARCHAR(200) NOT NULL,
    rule_type NVARCHAR(64) NOT NULL,
    action NVARCHAR(64) NOT NULL CONSTRAINT df_risk_rules_action DEFAULT N'require_approval',
    amount_minor BIGINT NULL,
    currency CHAR(3) NULL,
    destination_account NVARCHAR(256) NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT df_risk_rules_status DEFAULT N'active',
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_risk_rules_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_risk_rules_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_risk_rules_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT ck_risk_rules_type CHECK (rule_type IN (N'amount_threshold', N'blocked_destination')),
    CONSTRAINT ck_risk_rules_action CHECK (action IN (N'require_approval')),
    CONSTRAINT ck_risk_rules_status CHECK (status IN (N'active', N'disabled')),
    CONSTRAINT ck_risk_rules_currency CHECK (currency IS NULL OR currency LIKE '[A-Z][A-Z][A-Z]'),
    CONSTRAINT ck_risk_rules_amount_positive CHECK (amount_minor IS NULL OR amount_minor > 0)
  );

  CREATE INDEX ix_risk_rules_tenant_status ON dbo.risk_rules (tenant_id, status, created_at DESC);
END;

IF OBJECT_ID(N'dbo.payout_approvals', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.payout_approvals (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_payout_approvals PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    payout_id UNIQUEIDENTIFIER NOT NULL,
    risk_rule_id UNIQUEIDENTIFIER NULL,
    external_id NVARCHAR(64) NOT NULL CONSTRAINT uq_payout_approvals_external_id UNIQUE,
    status NVARCHAR(32) NOT NULL CONSTRAINT df_payout_approvals_status DEFAULT N'pending',
    risk_reason NVARCHAR(500) NOT NULL,
    decided_by_actor_type NVARCHAR(64) NULL,
    decided_by_actor_id NVARCHAR(256) NULL,
    decision_reason NVARCHAR(500) NULL,
    decided_at DATETIME2(3) NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_payout_approvals_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL CONSTRAINT df_payout_approvals_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_payout_approvals_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT fk_payout_approvals_payout FOREIGN KEY (payout_id) REFERENCES dbo.payouts(id),
    CONSTRAINT fk_payout_approvals_risk_rule FOREIGN KEY (risk_rule_id) REFERENCES dbo.risk_rules(id),
    CONSTRAINT uq_payout_approvals_payout UNIQUE (payout_id),
    CONSTRAINT ck_payout_approvals_status CHECK (status IN (N'pending', N'approved', N'rejected'))
  );

  CREATE INDEX ix_payout_approvals_tenant_status ON dbo.payout_approvals (tenant_id, status, created_at DESC);
END;
`
  },
  {
    version: "006",
    name: "reconciliation_baseline",
    sql: `
IF OBJECT_ID(N'dbo.settlement_imports', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.settlement_imports (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_settlement_imports PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    external_id NVARCHAR(64) NOT NULL CONSTRAINT uq_settlement_imports_external_id UNIQUE,
    provider_name NVARCHAR(128) NOT NULL,
    file_name NVARCHAR(256) NOT NULL,
    file_sha256 CHAR(64) NOT NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT df_settlement_imports_status DEFAULT N'processing',
    row_count INT NOT NULL CONSTRAINT df_settlement_imports_row_count DEFAULT 0,
    matched_count INT NOT NULL CONSTRAINT df_settlement_imports_matched_count DEFAULT 0,
    discrepancy_count INT NOT NULL CONSTRAINT df_settlement_imports_discrepancy_count DEFAULT 0,
    imported_by_actor_type NVARCHAR(64) NOT NULL,
    imported_by_actor_id NVARCHAR(256) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_settlement_imports_created_at DEFAULT SYSUTCDATETIME(),
    completed_at DATETIME2(3) NULL,
    CONSTRAINT fk_settlement_imports_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT uq_settlement_imports_tenant_hash UNIQUE (tenant_id, file_sha256),
    CONSTRAINT ck_settlement_imports_status CHECK (status IN (N'processing', N'completed', N'failed')),
    CONSTRAINT ck_settlement_imports_counts CHECK (row_count >= 0 AND matched_count >= 0 AND discrepancy_count >= 0)
  );

  CREATE INDEX ix_settlement_imports_tenant_created_at ON dbo.settlement_imports (tenant_id, created_at DESC);
END;

IF OBJECT_ID(N'dbo.settlement_rows', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.settlement_rows (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_settlement_rows PRIMARY KEY DEFAULT NEWID(),
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    settlement_import_id UNIQUEIDENTIFIER NOT NULL,
    payout_id UNIQUEIDENTIFIER NULL,
    provider_payout_id NVARCHAR(128) NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL,
    provider_status NVARCHAR(64) NOT NULL,
    settled_at DATETIME2(3) NULL,
    match_status NVARCHAR(32) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_settlement_rows_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_settlement_rows_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT fk_settlement_rows_import FOREIGN KEY (settlement_import_id) REFERENCES dbo.settlement_imports(id),
    CONSTRAINT fk_settlement_rows_payout FOREIGN KEY (payout_id) REFERENCES dbo.payouts(id),
    CONSTRAINT uq_settlement_rows_import_provider_id UNIQUE (settlement_import_id, provider_payout_id),
    CONSTRAINT ck_settlement_rows_amount_positive CHECK (amount_minor > 0),
    CONSTRAINT ck_settlement_rows_currency CHECK (currency LIKE '[A-Z][A-Z][A-Z]'),
    CONSTRAINT ck_settlement_rows_match_status CHECK (match_status IN (N'matched', N'missing', N'amount_mismatch'))
  );

  CREATE INDEX ix_settlement_rows_import ON dbo.settlement_rows (settlement_import_id, created_at ASC);
  CREATE INDEX ix_settlement_rows_tenant_match ON dbo.settlement_rows (tenant_id, match_status, created_at DESC);
END;

IF OBJECT_ID(N'dbo.reconciliation_discrepancies', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.reconciliation_discrepancies (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pk_reconciliation_discrepancies PRIMARY KEY DEFAULT NEWID(),
    external_id NVARCHAR(64) NOT NULL CONSTRAINT uq_reconciliation_discrepancies_external_id UNIQUE,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    settlement_import_id UNIQUEIDENTIFIER NOT NULL,
    settlement_row_id UNIQUEIDENTIFIER NOT NULL,
    payout_id UNIQUEIDENTIFIER NULL,
    discrepancy_type NVARCHAR(32) NOT NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT df_reconciliation_discrepancies_status DEFAULT N'open',
    expected_amount_minor BIGINT NULL,
    actual_amount_minor BIGINT NOT NULL,
    expected_currency CHAR(3) NULL,
    actual_currency CHAR(3) NOT NULL,
    created_at DATETIME2(3) NOT NULL CONSTRAINT df_reconciliation_discrepancies_created_at DEFAULT SYSUTCDATETIME(),
    resolved_at DATETIME2(3) NULL,
    resolved_by_actor_id NVARCHAR(256) NULL,
    CONSTRAINT fk_reconciliation_discrepancies_tenant FOREIGN KEY (tenant_id) REFERENCES dbo.tenants(id),
    CONSTRAINT fk_reconciliation_discrepancies_import FOREIGN KEY (settlement_import_id) REFERENCES dbo.settlement_imports(id),
    CONSTRAINT fk_reconciliation_discrepancies_row FOREIGN KEY (settlement_row_id) REFERENCES dbo.settlement_rows(id),
    CONSTRAINT fk_reconciliation_discrepancies_payout FOREIGN KEY (payout_id) REFERENCES dbo.payouts(id),
    CONSTRAINT uq_reconciliation_discrepancies_row UNIQUE (settlement_row_id),
    CONSTRAINT ck_reconciliation_discrepancies_type CHECK (discrepancy_type IN (N'missing', N'amount_mismatch')),
    CONSTRAINT ck_reconciliation_discrepancies_status CHECK (status IN (N'open', N'resolved')),
    CONSTRAINT ck_reconciliation_discrepancies_actual_amount CHECK (actual_amount_minor > 0)
  );

  CREATE INDEX ix_reconciliation_discrepancies_tenant_status ON dbo.reconciliation_discrepancies (tenant_id, status, created_at DESC);
END;
`
  },
  {
    version: "007",
    name: "durable_async_backbone",
    sql: `
IF COL_LENGTH(N'dbo.outbox_events', N'available_at') IS NULL
BEGIN
  ALTER TABLE dbo.outbox_events ADD available_at DATETIME2(3) NULL;
  EXEC sp_executesql N'
    UPDATE dbo.outbox_events
    SET available_at = created_at
    WHERE available_at IS NULL;

    ALTER TABLE dbo.outbox_events ALTER COLUMN available_at DATETIME2(3) NOT NULL;
    ALTER TABLE dbo.outbox_events
      ADD CONSTRAINT df_outbox_events_available_at DEFAULT SYSUTCDATETIME() FOR available_at;
  ';
END;

IF COL_LENGTH(N'dbo.outbox_events', N'locked_until') IS NULL
BEGIN
  ALTER TABLE dbo.outbox_events ADD locked_until DATETIME2(3) NULL;
END;

IF COL_LENGTH(N'dbo.outbox_events', N'locked_by') IS NULL
BEGIN
  ALTER TABLE dbo.outbox_events ADD locked_by NVARCHAR(128) NULL;
END;

IF COL_LENGTH(N'dbo.outbox_events', N'last_error') IS NULL
BEGIN
  ALTER TABLE dbo.outbox_events ADD last_error NVARCHAR(1000) NULL;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'ix_outbox_events_relay'
    AND object_id = OBJECT_ID(N'dbo.outbox_events')
)
BEGIN
  EXEC sp_executesql N'
    CREATE INDEX ix_outbox_events_relay
      ON dbo.outbox_events (status, available_at, locked_until, created_at ASC);
  ';
END;

IF COL_LENGTH(N'dbo.payouts', N'dispatch_attempts') IS NULL
BEGIN
  ALTER TABLE dbo.payouts ADD dispatch_attempts INT NOT NULL
    CONSTRAINT df_payouts_dispatch_attempts DEFAULT 0;
END;

IF COL_LENGTH(N'dbo.payouts', N'dispatch_last_error') IS NULL
BEGIN
  ALTER TABLE dbo.payouts ADD dispatch_last_error NVARCHAR(1000) NULL;
END;

IF COL_LENGTH(N'dbo.payouts', N'dispatch_dead_lettered_at') IS NULL
BEGIN
  ALTER TABLE dbo.payouts ADD dispatch_dead_lettered_at DATETIME2(3) NULL;
END;

IF COL_LENGTH(N'dbo.webhook_deliveries', N'queue_job_id') IS NULL
BEGIN
  ALTER TABLE dbo.webhook_deliveries ADD queue_job_id NVARCHAR(128) NULL;
END;

IF COL_LENGTH(N'dbo.webhook_deliveries', N'queued_at') IS NULL
BEGIN
  ALTER TABLE dbo.webhook_deliveries ADD queued_at DATETIME2(3) NULL;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'ix_webhook_deliveries_queue'
    AND object_id = OBJECT_ID(N'dbo.webhook_deliveries')
)
BEGIN
  CREATE INDEX ix_webhook_deliveries_queue
    ON dbo.webhook_deliveries (status, queue_job_id, next_attempt_at, created_at ASC);
END;
`
  }
];
