import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ApiClientSummary,
  ApiKeySummary,
  AuditLogSummary,
  DeleteWebhookEndpointResponse,
  CreateWebhookEndpointResponse,
  LedgerEntrySummary,
  OutboxEventSummary,
  PayoutApprovalSummary,
  RiskRuleSummary,
  PayoutSummary,
  TenantDashboardResponse,
  TenantSummary,
  UserMembershipSummary,
  UserMembershipRole,
  WebhookDeliverySummary,
  WebhookEndpointSummary
} from "@paymentops/contracts";
import sql from "mssql";

import { DatabaseService } from "../database/database.service.js";

interface TenantRow {
  id: string;
  external_id: string;
  name: string;
  status: "active" | "suspended" | "archived";
  created_at: Date;
}

interface MembershipRow {
  id: string;
  user_email: string;
  role: UserMembershipRole;
  status: "active" | "invited" | "disabled";
  created_at: Date;
}

interface ApiClientRow {
  id: string;
  external_id: string;
  name: string;
  status: "active" | "disabled";
  created_at: Date;
}

interface ApiKeyRow {
  id: string;
  api_client_id?: string;
  api_client_external_id?: string;
  external_id: string;
  name: string;
  key_prefix: string;
  permissions_json: string;
  expires_at: Date | null;
  revoked_at?: Date | null;
  created_at: Date;
}

interface WebhookEndpointRow {
  id: string;
  external_id: string;
  url: string;
  description: string | null;
  event_subscriptions_json: string;
  status: "active" | "disabled";
  created_at: Date;
}

interface WebhookDeliveryRow {
  external_id: string;
  webhook_endpoint_external_id: string;
  outbox_event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  status: WebhookDeliverySummary["status"];
  attempts: number;
  next_attempt_at: Date | null;
  last_attempted_at: Date | null;
  delivered_at: Date | null;
  last_status_code: number | null;
  last_error: string | null;
  created_at: Date;
}

interface AuditLogRow {
  id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  created_at: Date;
}

interface PayoutRow {
  external_id: string;
  provider_payout_id: string | null;
  amount_minor: number | string;
  currency: string;
  destination_account: string;
  reference: string | null;
  description: string | null;
  status: PayoutSummary["status"];
  created_at: Date;
  updated_at: Date;
}

interface LedgerEntryRow {
  id: number | string;
  external_id: string;
  payout_external_id: string;
  direction: "debit" | "credit";
  account_name: string;
  amount_minor: number | string;
  currency: string;
  created_at: Date;
}

interface OutboxEventRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  status: OutboxEventSummary["status"];
  attempts: number;
  created_at: Date;
}

interface RiskRuleRow {
  external_id: string;
  name: string;
  rule_type: RiskRuleSummary["type"];
  action: RiskRuleSummary["action"];
  amount_minor: number | string | null;
  currency: string | null;
  destination_account: string | null;
  status: RiskRuleSummary["status"];
  created_at: Date;
}

interface ApprovalQueueRow {
  approval_external_id: string;
  payout_external_id: string;
  risk_rule_external_id: string | null;
  risk_reason: string;
  approval_status: PayoutApprovalSummary["status"];
  amount_minor: number | string;
  currency: string;
  destination_account: string;
  requested_at: Date;
  decided_at: Date | null;
  decided_by_actor_id: string | null;
}

export interface ApiKeyCreateResult extends ApiKeySummary {
  secret: string;
}

@Injectable()
export class OperationsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async createTenant(input: {
    externalId: string;
    name: string;
    ownerEmail: string;
  }): Promise<TenantSummary> {
    const pool = await this.database.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const tenant = await new sql.Request(transaction)
        .input("externalId", sql.NVarChar(64), input.externalId)
        .input("name", sql.NVarChar(200), input.name).query<TenantRow>(`
INSERT INTO dbo.tenants (external_id, name)
OUTPUT inserted.id, inserted.external_id, inserted.name, inserted.status, inserted.created_at
VALUES (@externalId, @name);
`);

      const tenantId = tenant.recordset[0].id;

      await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenantId)
        .input("email", sql.NVarChar(256), input.ownerEmail)
        .input("role", sql.NVarChar(64), "merchant_owner").query(`
INSERT INTO dbo.user_memberships (tenant_id, user_email, role)
VALUES (@tenantId, @email, @role);
`);

      await insertAuditLog(transaction, {
        tenantId,
        action: "tenant.created",
        resourceType: "tenant",
        resourceId: input.externalId,
        metadata: { name: input.name, ownerEmail: input.ownerEmail }
      });

      await transaction.commit();
      return mapTenant(tenant.recordset[0]);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async updateTenant(
    tenantExternalId: string,
    input: { name?: string; status?: TenantSummary["status"] }
  ): Promise<TenantSummary> {
    const tenant = await this.requireTenant(tenantExternalId);
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("name", sql.NVarChar(200), input.name ?? null)
      .input("status", sql.NVarChar(32), input.status ?? null)
      .query<TenantRow>(`
UPDATE dbo.tenants
SET
  name = COALESCE(@name, name),
  status = COALESCE(@status, status),
  updated_at = SYSUTCDATETIME()
OUTPUT inserted.id, inserted.external_id, inserted.name, inserted.status, inserted.created_at
WHERE id = @tenantId;
`);

    await this.writeAuditLog({
      tenantId: tenant.id,
      action: "tenant.updated",
      resourceType: "tenant",
      resourceId: tenantExternalId,
      metadata: input
    });
    return mapTenant(result.recordset[0]);
  }

  async createMembership(input: {
    tenantExternalId: string;
    email: string;
    role: UserMembershipRole;
    status: UserMembershipSummary["status"];
  }): Promise<UserMembershipSummary> {
    const tenant = await this.requireTenant(input.tenantExternalId);
    if (await this.findMembershipByEmail(tenant.id, input.email)) {
      throw new ConflictException("A membership already exists for this email");
    }

    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("email", sql.NVarChar(256), input.email)
      .input("role", sql.NVarChar(64), input.role)
      .input("status", sql.NVarChar(32), input.status)
      .query<MembershipRow>(`
INSERT INTO dbo.user_memberships (tenant_id, user_email, role, status)
OUTPUT inserted.id, inserted.user_email, inserted.role, inserted.status, inserted.created_at
VALUES (@tenantId, @email, @role, @status);
`);

    await this.writeAuditLog({
      tenantId: tenant.id,
      action: "membership.created",
      resourceType: "user_membership",
      resourceId: result.recordset[0].id,
      metadata: { email: input.email, role: input.role, status: input.status }
    });
    return mapMembership(result.recordset[0]);
  }

  async updateMembership(
    tenantExternalId: string,
    membershipId: string,
    input: { role?: UserMembershipRole; status?: UserMembershipSummary["status"] }
  ): Promise<UserMembershipSummary> {
    const tenant = await this.requireTenant(tenantExternalId);
    const membership = await this.findMembership(tenant.id, membershipId);
    if (!membership) {
      throw new NotFoundException("Tenant membership was not found");
    }

    const removesActiveOwner =
      membership.role === "merchant_owner" &&
      membership.status === "active" &&
      (input.role === "developer" ||
        (input.status !== undefined && input.status !== "active"));
    if (removesActiveOwner && (await this.countOtherActiveOwners(tenant.id, membershipId)) === 0) {
      throw new ConflictException("A tenant must retain at least one active owner");
    }

    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("membershipId", sql.UniqueIdentifier, membershipId)
      .input("role", sql.NVarChar(64), input.role ?? null)
      .input("status", sql.NVarChar(32), input.status ?? null)
      .query<MembershipRow>(`
UPDATE dbo.user_memberships
SET
  role = COALESCE(@role, role),
  status = COALESCE(@status, status),
  updated_at = SYSUTCDATETIME()
OUTPUT inserted.id, inserted.user_email, inserted.role, inserted.status, inserted.created_at
WHERE id = @membershipId AND tenant_id = @tenantId;
`);

    await this.writeAuditLog({
      tenantId: tenant.id,
      action: "membership.updated",
      resourceType: "user_membership",
      resourceId: membershipId,
      metadata: input
    });
    return mapMembership(result.recordset[0]);
  }

  async ensureDemoTenant(): Promise<TenantDashboardResponse> {
    const existing = await this.findTenantByExternalId("mer_demo_northstar");

    if (existing) {
      await this.ensureDemoChildren(existing.id);
      return this.getTenantDashboard(existing.external_id);
    }

    await this.createTenant({
      externalId: "mer_demo_northstar",
      name: "Northstar Marketplaces",
      ownerEmail: "owner@northstar.example"
    });

    await this.ensureDemoChildren("mer_demo_northstar");
    return this.getTenantDashboard("mer_demo_northstar");
  }

  async createApiClient(input: {
    tenantExternalId: string;
    externalId: string;
    name: string;
  }): Promise<ApiClientSummary> {
    const tenant = await this.requireTenant(input.tenantExternalId);
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("externalId", sql.NVarChar(64), input.externalId)
      .input("name", sql.NVarChar(200), input.name).query<ApiClientRow>(`
INSERT INTO dbo.api_clients (tenant_id, external_id, name)
OUTPUT inserted.id, inserted.external_id, inserted.name, inserted.status, inserted.created_at
VALUES (@tenantId, @externalId, @name);
`);

    await this.writeAuditLog({
      tenantId: tenant.id,
      action: "api_client.created",
      resourceType: "api_client",
      resourceId: input.externalId,
      metadata: { name: input.name }
    });

    return mapApiClient(result.recordset[0]);
  }

  async updateApiClient(
    tenantExternalId: string,
    apiClientExternalId: string,
    status: ApiClientSummary["status"]
  ): Promise<ApiClientSummary> {
    const tenant = await this.requireTenant(tenantExternalId);
    await this.requireApiClient(tenant.id, apiClientExternalId);
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("externalId", sql.NVarChar(64), apiClientExternalId)
      .input("status", sql.NVarChar(32), status)
      .query<ApiClientRow>(`
UPDATE dbo.api_clients
SET status = @status, updated_at = SYSUTCDATETIME()
OUTPUT inserted.id, inserted.external_id, inserted.name, inserted.status, inserted.created_at
WHERE tenant_id = @tenantId AND external_id = @externalId;
`);

    await this.writeAuditLog({
      tenantId: tenant.id,
      action: status === "disabled" ? "api_client.disabled" : "api_client.enabled",
      resourceType: "api_client",
      resourceId: apiClientExternalId,
      metadata: { status }
    });
    return mapApiClient(result.recordset[0]);
  }

  async createApiKey(input: {
    tenantExternalId: string;
    apiClientExternalId: string;
    externalId: string;
    name: string;
    keyHash: string;
    keyPrefix: string;
    permissions: string[];
    expiresAt: string | null;
    secret: string;
  }): Promise<ApiKeyCreateResult> {
    const tenant = await this.requireTenant(input.tenantExternalId);
    const apiClient = await this.requireApiClient(tenant.id, input.apiClientExternalId);
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("apiClientId", sql.UniqueIdentifier, apiClient.id)
      .input("externalId", sql.NVarChar(64), input.externalId)
      .input("name", sql.NVarChar(200), input.name)
      .input("keyHash", sql.NVarChar(128), input.keyHash)
      .input("keyPrefix", sql.NVarChar(32), input.keyPrefix)
      .input("permissionsJson", sql.NVarChar(sql.MAX), JSON.stringify(input.permissions))
      .input("expiresAt", sql.DateTime2, input.expiresAt ? new Date(input.expiresAt) : null)
      .query<ApiKeyRow>(`
INSERT INTO dbo.api_keys (
  tenant_id,
  api_client_id,
  external_id,
  name,
  key_hash,
  key_prefix,
  permissions_json,
  expires_at
)
OUTPUT
  inserted.id,
  inserted.external_id,
  inserted.name,
  inserted.key_prefix,
  inserted.permissions_json,
  inserted.expires_at,
  inserted.created_at
VALUES (@tenantId, @apiClientId, @externalId, @name, @keyHash, @keyPrefix, @permissionsJson, @expiresAt);
`);

    await this.writeAuditLog({
      tenantId: tenant.id,
      action: "api_key.created",
      resourceType: "api_key",
      resourceId: input.externalId,
      metadata: { apiClientId: input.apiClientExternalId, permissions: input.permissions }
    });

    return {
      ...mapApiKey(result.recordset[0]),
      secret: input.secret
    };
  }

  async rotateApiKey(input: {
    tenantExternalId: string;
    apiKeyExternalId: string;
    replacementExternalId: string;
    name?: string;
    keyHash: string;
    keyPrefix: string;
    permissions?: string[];
    expiresAt?: string | null;
    secret: string;
  }): Promise<ApiKeyCreateResult> {
    const tenant = await this.requireTenant(input.tenantExternalId);
    const current = await this.requireApiKey(tenant.id, input.apiKeyExternalId);
    if (current.revoked_at) {
      throw new ConflictException("The API key has already been revoked");
    }

    const permissions =
      input.permissions ?? (JSON.parse(current.permissions_json) as string[]);
    const expiresAt =
      input.expiresAt === undefined
        ? current.expires_at
        : input.expiresAt
          ? new Date(input.expiresAt)
          : null;
    const pool = await this.database.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("apiKeyId", sql.UniqueIdentifier, current.id)
        .query(`
UPDATE dbo.api_keys
SET revoked_at = SYSUTCDATETIME()
WHERE id = @apiKeyId AND tenant_id = @tenantId AND revoked_at IS NULL;
`);

      const result = await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("apiClientId", sql.UniqueIdentifier, current.api_client_id)
        .input("externalId", sql.NVarChar(64), input.replacementExternalId)
        .input("name", sql.NVarChar(200), input.name ?? current.name + " rotated")
        .input("keyHash", sql.NVarChar(128), input.keyHash)
        .input("keyPrefix", sql.NVarChar(32), input.keyPrefix)
        .input("permissionsJson", sql.NVarChar(sql.MAX), JSON.stringify(permissions))
        .input("expiresAt", sql.DateTime2, expiresAt)
        .query<ApiKeyRow>(`
INSERT INTO dbo.api_keys (
  tenant_id,
  api_client_id,
  external_id,
  name,
  key_hash,
  key_prefix,
  permissions_json,
  expires_at
)
OUTPUT
  inserted.id,
  inserted.external_id,
  inserted.name,
  inserted.key_prefix,
  inserted.permissions_json,
  inserted.expires_at,
  inserted.created_at
VALUES (@tenantId, @apiClientId, @externalId, @name, @keyHash, @keyPrefix, @permissionsJson, @expiresAt);
`);

      await insertAuditLog(transaction, {
        tenantId: tenant.id,
        action: "api_key.rotated",
        resourceType: "api_key",
        resourceId: input.apiKeyExternalId,
        metadata: { replacementApiKeyId: input.replacementExternalId }
      });
      await transaction.commit();
      return { ...mapApiKey(result.recordset[0]), secret: input.secret };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async revokeApiKey(tenantExternalId: string, apiKeyExternalId: string) {
    const tenant = await this.requireTenant(tenantExternalId);
    const apiKey = await this.requireApiKey(tenant.id, apiKeyExternalId);
    if (apiKey.revoked_at) {
      throw new ConflictException("The API key has already been revoked");
    }

    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("apiKeyId", sql.UniqueIdentifier, apiKey.id)
      .query<{ revoked_at: Date }>(`
UPDATE dbo.api_keys
SET revoked_at = SYSUTCDATETIME()
OUTPUT inserted.revoked_at
WHERE id = @apiKeyId AND tenant_id = @tenantId AND revoked_at IS NULL;
`);

    await this.writeAuditLog({
      tenantId: tenant.id,
      action: "api_key.revoked",
      resourceType: "api_key",
      resourceId: apiKeyExternalId,
      metadata: {}
    });
    return {
      id: apiKeyExternalId,
      status: "revoked" as const,
      revokedAt: result.recordset[0].revoked_at.toISOString()
    };
  }

  async createWebhookEndpoint(input: {
    tenantExternalId: string;
    externalId: string;
    url: string;
    description: string | null;
    secretHash: string;
    signingSecret: string;
    eventSubscriptions: string[];
  }): Promise<CreateWebhookEndpointResponse> {
    const tenant = await this.requireTenant(input.tenantExternalId);
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("externalId", sql.NVarChar(64), input.externalId)
      .input("url", sql.NVarChar(2048), input.url)
      .input("description", sql.NVarChar(500), input.description)
      .input("secretHash", sql.NVarChar(128), input.secretHash)
      .input("signingSecret", sql.NVarChar(128), input.signingSecret)
      .input("eventsJson", sql.NVarChar(sql.MAX), JSON.stringify(input.eventSubscriptions))
      .query<WebhookEndpointRow>(`
INSERT INTO dbo.webhook_endpoints (
  tenant_id,
  external_id,
  url,
  description,
  secret_hash,
  signing_secret,
  event_subscriptions_json
)
OUTPUT
  inserted.id,
  inserted.external_id,
  inserted.url,
  inserted.description,
  inserted.event_subscriptions_json,
  inserted.status,
  inserted.created_at
VALUES (@tenantId, @externalId, @url, @description, @secretHash, @signingSecret, @eventsJson);
`);

    await this.writeAuditLog({
      tenantId: tenant.id,
      action: "webhook_endpoint.created",
      resourceType: "webhook_endpoint",
      resourceId: input.externalId,
      metadata: { url: input.url, eventSubscriptions: input.eventSubscriptions }
    });

    return {
      ...mapWebhookEndpoint(result.recordset[0]),
      secret: input.signingSecret
    };
  }

  async updateWebhookEndpoint(
    tenantExternalId: string,
    webhookExternalId: string,
    input: {
      url?: string;
      description?: string | null;
      eventSubscriptions?: string[];
      status?: WebhookEndpointSummary["status"];
    }
  ): Promise<WebhookEndpointSummary> {
    const tenant = await this.requireTenant(tenantExternalId);
    await this.requireWebhookEndpoint(tenant.id, webhookExternalId);
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("externalId", sql.NVarChar(64), webhookExternalId)
      .input("url", sql.NVarChar(2048), input.url ?? null)
      .input("description", sql.NVarChar(500), input.description ?? null)
      .input("descriptionProvided", sql.Bit, input.description !== undefined)
      .input(
        "eventsJson",
        sql.NVarChar(sql.MAX),
        input.eventSubscriptions ? JSON.stringify(input.eventSubscriptions) : null
      )
      .input("status", sql.NVarChar(32), input.status ?? null)
      .query<WebhookEndpointRow>(`
UPDATE dbo.webhook_endpoints
SET
  url = COALESCE(@url, url),
  description = CASE WHEN @descriptionProvided = 1 THEN @description ELSE description END,
  event_subscriptions_json = COALESCE(@eventsJson, event_subscriptions_json),
  status = COALESCE(@status, status),
  updated_at = SYSUTCDATETIME()
OUTPUT
  inserted.id,
  inserted.external_id,
  inserted.url,
  inserted.description,
  inserted.event_subscriptions_json,
  inserted.status,
  inserted.created_at
WHERE tenant_id = @tenantId
  AND external_id = @externalId
  AND deleted_at IS NULL;
`);

    await this.writeAuditLog({
      tenantId: tenant.id,
      action: "webhook_endpoint.updated",
      resourceType: "webhook_endpoint",
      resourceId: webhookExternalId,
      metadata: input
    });
    return mapWebhookEndpoint(result.recordset[0]);
  }

  async deleteWebhookEndpoint(
    tenantExternalId: string,
    webhookExternalId: string
  ): Promise<DeleteWebhookEndpointResponse> {
    const tenant = await this.requireTenant(tenantExternalId);
    await this.requireWebhookEndpoint(tenant.id, webhookExternalId);
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("externalId", sql.NVarChar(64), webhookExternalId)
      .query<{ deleted_at: Date }>(`
UPDATE dbo.webhook_endpoints
SET status = N'disabled', deleted_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
OUTPUT inserted.deleted_at
WHERE tenant_id = @tenantId
  AND external_id = @externalId
  AND deleted_at IS NULL;
`);

    await this.writeAuditLog({
      tenantId: tenant.id,
      action: "webhook_endpoint.deleted",
      resourceType: "webhook_endpoint",
      resourceId: webhookExternalId,
      metadata: {}
    });
    return {
      id: webhookExternalId,
      deleted: true,
      deletedAt: result.recordset[0].deleted_at.toISOString()
    };
  }

  async getTenantDashboard(tenantExternalId: string): Promise<TenantDashboardResponse> {
    const tenant = await this.requireTenant(tenantExternalId);
    const pool = await this.database.connect();

    const memberships = await pool.request().input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<MembershipRow>(`
SELECT id, user_email, role, status, created_at
FROM dbo.user_memberships
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    const apiClients = await pool.request().input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<ApiClientRow>(`
SELECT id, external_id, name, status, created_at
FROM dbo.api_clients
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    const apiKeys = await pool.request().input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<ApiKeyRow>(`
SELECT id, external_id, name, key_prefix, permissions_json, expires_at, created_at
FROM dbo.api_keys
WHERE tenant_id = @tenantId AND revoked_at IS NULL
ORDER BY created_at DESC;
`);

    const webhooks = await pool.request().input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<WebhookEndpointRow>(`
SELECT id, external_id, url, description, event_subscriptions_json, status, created_at
FROM dbo.webhook_endpoints
WHERE tenant_id = @tenantId AND deleted_at IS NULL
ORDER BY created_at DESC;
`);

    const auditLogs = await pool.request().input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<AuditLogRow>(`
SELECT TOP 10 id, actor_type, actor_id, action, resource_type, resource_id, created_at
FROM dbo.audit_logs
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    const payouts = await pool.request().input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<PayoutRow>(`
SELECT TOP 10 external_id, provider_payout_id, amount_minor, currency, destination_account, reference, description, status, created_at, updated_at
FROM dbo.payouts
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    const ledgerEntries = await pool.request().input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<LedgerEntryRow>(`
SELECT TOP 10
  ledger_entries.id,
  ledger_entries.external_id,
  payouts.external_id AS payout_external_id,
  ledger_entries.direction,
  ledger_entries.account_name,
  ledger_entries.amount_minor,
  ledger_entries.currency,
  ledger_entries.created_at
FROM dbo.ledger_entries
INNER JOIN dbo.payouts ON payouts.id = ledger_entries.payout_id
WHERE ledger_entries.tenant_id = @tenantId
ORDER BY ledger_entries.created_at DESC, ledger_entries.id DESC;
`);

    const outboxEvents = await pool.request().input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<OutboxEventRow>(`
SELECT TOP 10 id, event_type, aggregate_type, aggregate_id, status, attempts, created_at
FROM dbo.outbox_events
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    const webhookDeliveries = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id).query<WebhookDeliveryRow>(`
SELECT TOP 10
  webhook_deliveries.external_id,
  webhook_endpoints.external_id AS webhook_endpoint_external_id,
  CONVERT(NVARCHAR(36), webhook_deliveries.outbox_event_id) AS outbox_event_id,
  webhook_deliveries.event_type,
  webhook_deliveries.aggregate_type,
  webhook_deliveries.aggregate_id,
  webhook_deliveries.status,
  webhook_deliveries.attempts,
  webhook_deliveries.next_attempt_at,
  webhook_deliveries.last_attempted_at,
  webhook_deliveries.delivered_at,
  webhook_deliveries.last_status_code,
  webhook_deliveries.last_error,
  webhook_deliveries.created_at
FROM dbo.webhook_deliveries
INNER JOIN dbo.webhook_endpoints ON webhook_endpoints.id = webhook_deliveries.webhook_endpoint_id
WHERE webhook_deliveries.tenant_id = @tenantId
ORDER BY webhook_deliveries.created_at DESC;
`);

    const riskRules = await pool.request().input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<RiskRuleRow>(`
SELECT TOP 10 external_id, name, rule_type, action, amount_minor, currency, destination_account, status, created_at
FROM dbo.risk_rules
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    const approvals = await pool.request().input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<ApprovalQueueRow>(`
SELECT TOP 10
  payout_approvals.external_id AS approval_external_id,
  payouts.external_id AS payout_external_id,
  risk_rules.external_id AS risk_rule_external_id,
  payout_approvals.risk_reason,
  payout_approvals.status AS approval_status,
  payouts.amount_minor,
  payouts.currency,
  payouts.destination_account,
  payout_approvals.created_at AS requested_at,
  payout_approvals.decided_at,
  payout_approvals.decided_by_actor_id
FROM dbo.payout_approvals
INNER JOIN dbo.payouts ON payouts.id = payout_approvals.payout_id
LEFT JOIN dbo.risk_rules ON risk_rules.id = payout_approvals.risk_rule_id
WHERE payout_approvals.tenant_id = @tenantId
ORDER BY CASE WHEN payout_approvals.status = N'pending' THEN 0 ELSE 1 END, payout_approvals.created_at DESC;
`);

    return {
      tenant: mapTenant(tenant),
      memberships: memberships.recordset.map(mapMembership),
      apiClients: apiClients.recordset.map(mapApiClient),
      apiKeys: apiKeys.recordset.map(mapApiKey),
      webhookEndpoints: webhooks.recordset.map(mapWebhookEndpoint),
      webhookDeliveries: webhookDeliveries.recordset.map(mapWebhookDelivery),
      riskRules: riskRules.recordset.map(mapRiskRule),
      approvals: approvals.recordset.map((row) => mapApproval(row, tenant.external_id)),
      payouts: payouts.recordset.map((row) => mapPayout(row, tenant.external_id)),
      ledgerEntries: ledgerEntries.recordset.map(mapLedgerEntry),
      outboxEvents: outboxEvents.recordset.map(mapOutboxEvent),
      auditLogs: auditLogs.recordset.map(mapAuditLog),
      metrics: {
        members: memberships.recordset.length,
        apiClients: apiClients.recordset.length,
        activeApiKeys: apiKeys.recordset.length,
        webhookEndpoints: webhooks.recordset.length,
        webhookDeliveries: webhookDeliveries.recordset.length,
        failedWebhookDeliveries: webhookDeliveries.recordset.filter(
          (delivery) => delivery.status === "failed" || delivery.status === "dead_letter"
        ).length,
        riskRules: riskRules.recordset.length,
        pendingApprovals: approvals.recordset.filter(
          (approval) => approval.approval_status === "pending"
        ).length,
        payouts: payouts.recordset.length,
        ledgerEntries: ledgerEntries.recordset.length,
        pendingOutboxEvents: outboxEvents.recordset.filter((event) => event.status === "pending")
          .length,
        auditEvents: auditLogs.recordset.length
      }
    };
  }

  async findTenantByExternalId(externalId: string): Promise<TenantRow | null> {
    const pool = await this.database.connect();
    const result = await pool.request().input("externalId", sql.NVarChar(64), externalId)
      .query<TenantRow>(`
SELECT id, external_id, name, status, created_at
FROM dbo.tenants
WHERE external_id = @externalId;
`);

    return result.recordset[0] ?? null;
  }

  private async ensureDemoChildren(tenantExternalIdOrId: string): Promise<void> {
    const tenant = tenantExternalIdOrId.startsWith("mer_")
      ? await this.requireTenant(tenantExternalIdOrId)
      : await this.requireTenantById(tenantExternalIdOrId);

    const client = await this.findApiClient(tenant.id, "cli_demo_checkout");
    if (!client) {
      await this.createApiClient({
        tenantExternalId: tenant.external_id,
        externalId: "cli_demo_checkout",
        name: "Checkout Service"
      });
    }

    const apiKey = await this.findApiKey(tenant.id, "key_demo_checkout");
    if (!apiKey) {
      await this.insertSeedApiKey(tenant.id);
    }

    const riskRule = await this.findRiskRule(tenant.id, "risk_demo_high_value");
    if (!riskRule) {
      await this.insertSeedRiskRule(tenant.id);
    }

    const webhook = await this.findWebhookEndpoint(tenant.id, "whk_demo_ops");
    if (!webhook) {
      await this.createWebhookEndpoint({
        tenantExternalId: tenant.external_id,
        externalId: "whk_demo_ops",
        url: "https://webhooks.example.com/paymentops/events",
        description: "Demo operations webhook endpoint",
        secretHash: "seeded-webhook-secret-hash",
        signingSecret: "whsec_demo_northstar",
        eventSubscriptions: [
          "payout.created.v1",
          "payout.processing.v1",
          "payout.paid.v1",
          "payout.failed.v1"
        ]
      });
    }
  }

  private async insertSeedApiKey(tenantId: string): Promise<void> {
    const apiClient = await this.requireApiClient(tenantId, "cli_demo_checkout");
    const pool = await this.database.connect();

    await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenantId)
      .input("apiClientId", sql.UniqueIdentifier, apiClient.id)
      .input("externalId", sql.NVarChar(64), "key_demo_checkout")
      .input("name", sql.NVarChar(200), "Demo checkout key")
      .input("keyHash", sql.NVarChar(128), "seeded-demo-key-hash")
      .input("keyPrefix", sql.NVarChar(32), "pops_demo_seeded")
      .input(
        "permissionsJson",
        sql.NVarChar(sql.MAX),
        JSON.stringify(["payouts:create", "payouts:read", "webhooks:manage"])
      ).query(`
INSERT INTO dbo.api_keys (
  tenant_id,
  api_client_id,
  external_id,
  name,
  key_hash,
  key_prefix,
  permissions_json
)
VALUES (@tenantId, @apiClientId, @externalId, @name, @keyHash, @keyPrefix, @permissionsJson);
`);

    await this.writeAuditLog({
      tenantId,
      action: "api_key.seeded",
      resourceType: "api_key",
      resourceId: "key_demo_checkout",
      metadata: { apiClientId: "cli_demo_checkout" }
    });
  }

  private async insertSeedRiskRule(tenantId: string): Promise<void> {
    const pool = await this.database.connect();

    await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenantId)
      .input("externalId", sql.NVarChar(64), "risk_demo_high_value")
      .input("name", sql.NVarChar(200), "High-value payout review")
      .input("amountMinor", sql.BigInt, 100000)
      .input("currency", sql.Char(3), "USD").query(`
INSERT INTO dbo.risk_rules (
  tenant_id,
  external_id,
  name,
  rule_type,
  action,
  amount_minor,
  currency
)
VALUES (@tenantId, @externalId, @name, N'amount_threshold', N'require_approval', @amountMinor, @currency);
`);

    await this.writeAuditLog({
      tenantId,
      action: "risk_rule.seeded",
      resourceType: "risk_rule",
      resourceId: "risk_demo_high_value",
      metadata: { threshold: 100000, currency: "USD" }
    });
  }

  private async findMembership(
    tenantId: string,
    membershipId: string
  ): Promise<MembershipRow | null> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenantId)
      .input("membershipId", sql.UniqueIdentifier, membershipId)
      .query<MembershipRow>(`
SELECT id, user_email, role, status, created_at
FROM dbo.user_memberships
WHERE tenant_id = @tenantId AND id = @membershipId;
`);
    return result.recordset[0] ?? null;
  }

  private async findMembershipByEmail(
    tenantId: string,
    email: string
  ): Promise<MembershipRow | null> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenantId)
      .input("email", sql.NVarChar(256), email.toLowerCase())
      .query<MembershipRow>(`
SELECT id, user_email, role, status, created_at
FROM dbo.user_memberships
WHERE tenant_id = @tenantId AND LOWER(user_email) = @email;
`);
    return result.recordset[0] ?? null;
  }

  private async countOtherActiveOwners(
    tenantId: string,
    membershipId: string
  ): Promise<number> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenantId)
      .input("membershipId", sql.UniqueIdentifier, membershipId)
      .query<{ owner_count: number }>(`
SELECT COUNT(*) AS owner_count
FROM dbo.user_memberships
WHERE tenant_id = @tenantId
  AND id <> @membershipId
  AND role = N'merchant_owner'
  AND status = N'active';
`);
    return Number(result.recordset[0].owner_count);
  }

  private async requireTenant(externalId: string): Promise<TenantRow> {
    const tenant = await this.findTenantByExternalId(externalId);

    if (!tenant) {
      throw new NotFoundException(`Tenant ${externalId} was not found`);
    }

    return tenant;
  }

  private async requireTenantById(id: string): Promise<TenantRow> {
    const pool = await this.database.connect();
    const result = await pool.request().input("id", sql.UniqueIdentifier, id).query<TenantRow>(`
SELECT id, external_id, name, status, created_at
FROM dbo.tenants
WHERE id = @id;
`);

    const tenant = result.recordset[0];

    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} was not found`);
    }

    return tenant;
  }

  private async requireApiClient(tenantId: string, externalId: string): Promise<ApiClientRow> {
    const apiClient = await this.findApiClient(tenantId, externalId);

    if (!apiClient) {
      throw new NotFoundException(`API client ${externalId} was not found`);
    }

    return apiClient;
  }

  private async findApiClient(tenantId: string, externalId: string): Promise<ApiClientRow | null> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenantId)
      .input("externalId", sql.NVarChar(64), externalId).query<ApiClientRow>(`
SELECT id, external_id, name, status, created_at
FROM dbo.api_clients
WHERE tenant_id = @tenantId AND external_id = @externalId;
`);

    return result.recordset[0] ?? null;
  }

  private async findApiKey(tenantId: string, externalId: string): Promise<ApiKeyRow | null> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenantId)
      .input("externalId", sql.NVarChar(64), externalId).query<ApiKeyRow>(`
SELECT
  api_keys.id,
  api_keys.api_client_id,
  api_clients.external_id AS api_client_external_id,
  api_keys.external_id,
  api_keys.name,
  api_keys.key_prefix,
  api_keys.permissions_json,
  api_keys.expires_at,
  api_keys.revoked_at,
  api_keys.created_at
FROM dbo.api_keys
INNER JOIN dbo.api_clients ON api_clients.id = api_keys.api_client_id
WHERE api_keys.tenant_id = @tenantId AND api_keys.external_id = @externalId;
`);

    return result.recordset[0] ?? null;
  }

  private async requireApiKey(tenantId: string, externalId: string): Promise<ApiKeyRow> {
    const apiKey = await this.findApiKey(tenantId, externalId);
    if (!apiKey) {
      throw new NotFoundException("API key " + externalId + " was not found");
    }
    return apiKey;
  }

  private async findWebhookEndpoint(
    tenantId: string,
    externalId: string
  ): Promise<WebhookEndpointRow | null> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenantId)
      .input("externalId", sql.NVarChar(64), externalId).query<WebhookEndpointRow>(`
SELECT id, external_id, url, description, event_subscriptions_json, status, created_at
FROM dbo.webhook_endpoints
WHERE tenant_id = @tenantId AND external_id = @externalId AND deleted_at IS NULL;
`);

    return result.recordset[0] ?? null;
  }

  private async requireWebhookEndpoint(
    tenantId: string,
    externalId: string
  ): Promise<WebhookEndpointRow> {
    const endpoint = await this.findWebhookEndpoint(tenantId, externalId);
    if (!endpoint) {
      throw new NotFoundException("Webhook endpoint " + externalId + " was not found");
    }
    return endpoint;
  }

  private async findRiskRule(tenantId: string, externalId: string): Promise<RiskRuleRow | null> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenantId)
      .input("externalId", sql.NVarChar(64), externalId).query<RiskRuleRow>(`
SELECT external_id, name, rule_type, action, amount_minor, currency, destination_account, status, created_at
FROM dbo.risk_rules
WHERE tenant_id = @tenantId AND external_id = @externalId;
`);

    return result.recordset[0] ?? null;
  }
  private async writeAuditLog(input: {
    tenantId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const pool = await this.database.connect();
    await insertAuditLog(pool, input);
  }
}

async function insertAuditLog(
  target: sql.ConnectionPool | sql.Transaction,
  input: {
    tenantId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  const request = target instanceof sql.ConnectionPool ? target.request() : new sql.Request(target);

  await request
    .input("tenantId", sql.UniqueIdentifier, input.tenantId)
    .input("actorType", sql.NVarChar(64), "system")
    .input("actorId", sql.NVarChar(256), "paymentops-api")
    .input("action", sql.NVarChar(128), input.action)
    .input("resourceType", sql.NVarChar(128), input.resourceType)
    .input("resourceId", sql.NVarChar(128), input.resourceId)
    .input("metadataJson", sql.NVarChar(sql.MAX), JSON.stringify(input.metadata)).query(`
INSERT INTO dbo.audit_logs (
  tenant_id,
  actor_type,
  actor_id,
  action,
  resource_type,
  resource_id,
  metadata_json
)
VALUES (@tenantId, @actorType, @actorId, @action, @resourceType, @resourceId, @metadataJson);
`);
}

function mapTenant(row: TenantRow): TenantSummary {
  return {
    id: row.external_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at.toISOString()
  };
}

function mapMembership(row: MembershipRow): UserMembershipSummary {
  return {
    id: row.id,
    email: row.user_email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at.toISOString()
  };
}

function mapApiClient(row: ApiClientRow): ApiClientSummary {
  return {
    id: row.external_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at.toISOString()
  };
}

function mapApiKey(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.external_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    permissions: JSON.parse(row.permissions_json) as string[],
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null
  };
}

function mapWebhookEndpoint(row: WebhookEndpointRow): WebhookEndpointSummary {
  return {
    id: row.external_id,
    url: row.url,
    description: row.description,
    eventSubscriptions: JSON.parse(row.event_subscriptions_json) as string[],
    status: row.status,
    createdAt: row.created_at.toISOString()
  };
}

function mapWebhookDelivery(row: WebhookDeliveryRow): WebhookDeliverySummary {
  return {
    id: row.external_id,
    webhookEndpointId: row.webhook_endpoint_external_id,
    eventId: row.outbox_event_id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at?.toISOString() ?? null,
    lastAttemptedAt: row.last_attempted_at?.toISOString() ?? null,
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString()
  };
}

function mapRiskRule(row: RiskRuleRow): RiskRuleSummary {
  return {
    id: row.external_id,
    name: row.name,
    type: row.rule_type,
    action: row.action,
    status: row.status,
    amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
    currency: row.currency?.trim() ?? null,
    destinationAccount: row.destination_account,
    createdAt: row.created_at.toISOString()
  };
}

function mapApproval(row: ApprovalQueueRow, tenantExternalId: string): PayoutApprovalSummary {
  return {
    id: row.approval_external_id,
    payoutId: row.payout_external_id,
    tenantId: tenantExternalId,
    status: row.approval_status,
    riskRuleId: row.risk_rule_external_id,
    riskReason: row.risk_reason,
    amountMinor: Number(row.amount_minor),
    currency: row.currency.trim(),
    destinationAccount: row.destination_account,
    requestedAt: row.requested_at.toISOString(),
    decidedAt: row.decided_at?.toISOString() ?? null,
    decidedBy: row.decided_by_actor_id
  };
}

function mapPayout(row: PayoutRow, tenantExternalId: string): PayoutSummary {
  return {
    id: row.external_id,
    tenantId: tenantExternalId,
    providerPayoutId: row.provider_payout_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency.trim(),
    destinationAccount: row.destination_account,
    reference: row.reference,
    description: row.description,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapLedgerEntry(row: LedgerEntryRow): LedgerEntrySummary {
  return {
    id: String(row.id),
    externalId: row.external_id,
    payoutId: row.payout_external_id,
    direction: row.direction,
    account: row.account_name,
    amountMinor: Number(row.amount_minor),
    currency: row.currency.trim(),
    createdAt: row.created_at.toISOString()
  };
}

function mapOutboxEvent(row: OutboxEventRow): OutboxEventSummary {
  return {
    id: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at.toISOString()
  };
}

function mapAuditLog(row: AuditLogRow): AuditLogSummary {
  return {
    id: String(row.id),
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    createdAt: row.created_at.toISOString()
  };
}
