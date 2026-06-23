import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ApiClientSummary,
  ApiKeySummary,
  AuditLogSummary,
  LedgerEntrySummary,
  OutboxEventSummary,
  PayoutSummary,
  TenantDashboardResponse,
  TenantSummary,
  UserMembershipSummary,
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
  role: string;
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
  external_id: string;
  name: string;
  key_prefix: string;
  permissions_json: string;
  expires_at: Date | null;
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

export interface ApiKeyCreateResult extends ApiKeySummary {
  secret: string;
}

@Injectable()
export class OperationsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async createTenant(input: { externalId: string; name: string; ownerEmail: string }): Promise<TenantSummary> {
    const pool = await this.database.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const tenant = await new sql.Request(transaction)
        .input("externalId", sql.NVarChar(64), input.externalId)
        .input("name", sql.NVarChar(200), input.name)
        .query<TenantRow>(`
INSERT INTO dbo.tenants (external_id, name)
OUTPUT inserted.id, inserted.external_id, inserted.name, inserted.status, inserted.created_at
VALUES (@externalId, @name);
`);

      const tenantId = tenant.recordset[0].id;

      await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenantId)
        .input("email", sql.NVarChar(256), input.ownerEmail)
        .input("role", sql.NVarChar(64), "merchant_owner")
        .query(`
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
      .input("name", sql.NVarChar(200), input.name)
      .query<ApiClientRow>(`
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

  async createWebhookEndpoint(input: {
    tenantExternalId: string;
    externalId: string;
    url: string;
    description: string | null;
    secretHash: string;
    eventSubscriptions: string[];
  }): Promise<WebhookEndpointSummary> {
    const tenant = await this.requireTenant(input.tenantExternalId);
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("externalId", sql.NVarChar(64), input.externalId)
      .input("url", sql.NVarChar(2048), input.url)
      .input("description", sql.NVarChar(500), input.description)
      .input("secretHash", sql.NVarChar(128), input.secretHash)
      .input("eventsJson", sql.NVarChar(sql.MAX), JSON.stringify(input.eventSubscriptions))
      .query<WebhookEndpointRow>(`
INSERT INTO dbo.webhook_endpoints (
  tenant_id,
  external_id,
  url,
  description,
  secret_hash,
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
VALUES (@tenantId, @externalId, @url, @description, @secretHash, @eventsJson);
`);

    await this.writeAuditLog({
      tenantId: tenant.id,
      action: "webhook_endpoint.created",
      resourceType: "webhook_endpoint",
      resourceId: input.externalId,
      metadata: { url: input.url, eventSubscriptions: input.eventSubscriptions }
    });

    return mapWebhookEndpoint(result.recordset[0]);
  }

  async getTenantDashboard(tenantExternalId: string): Promise<TenantDashboardResponse> {
    const tenant = await this.requireTenant(tenantExternalId);
    const pool = await this.database.connect();

    const memberships = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<MembershipRow>(`
SELECT id, user_email, role, status, created_at
FROM dbo.user_memberships
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    const apiClients = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<ApiClientRow>(`
SELECT id, external_id, name, status, created_at
FROM dbo.api_clients
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    const apiKeys = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<ApiKeyRow>(`
SELECT id, external_id, name, key_prefix, permissions_json, expires_at, created_at
FROM dbo.api_keys
WHERE tenant_id = @tenantId AND revoked_at IS NULL
ORDER BY created_at DESC;
`);

    const webhooks = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<WebhookEndpointRow>(`
SELECT id, external_id, url, description, event_subscriptions_json, status, created_at
FROM dbo.webhook_endpoints
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    const auditLogs = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<AuditLogRow>(`
SELECT TOP 10 id, actor_type, actor_id, action, resource_type, resource_id, created_at
FROM dbo.audit_logs
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    const payouts = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<PayoutRow>(`
SELECT TOP 10 external_id, provider_payout_id, amount_minor, currency, destination_account, reference, description, status, created_at, updated_at
FROM dbo.payouts
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    const ledgerEntries = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
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

    const outboxEvents = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<OutboxEventRow>(`
SELECT TOP 10 id, event_type, aggregate_type, aggregate_id, status, attempts, created_at
FROM dbo.outbox_events
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    return {
      tenant: mapTenant(tenant),
      memberships: memberships.recordset.map(mapMembership),
      apiClients: apiClients.recordset.map(mapApiClient),
      apiKeys: apiKeys.recordset.map(mapApiKey),
      webhookEndpoints: webhooks.recordset.map(mapWebhookEndpoint),
      payouts: payouts.recordset.map((row) => mapPayout(row, tenant.external_id)),
      ledgerEntries: ledgerEntries.recordset.map(mapLedgerEntry),
      outboxEvents: outboxEvents.recordset.map(mapOutboxEvent),
      auditLogs: auditLogs.recordset.map(mapAuditLog),
      metrics: {
        members: memberships.recordset.length,
        apiClients: apiClients.recordset.length,
        activeApiKeys: apiKeys.recordset.length,
        webhookEndpoints: webhooks.recordset.length,
        payouts: payouts.recordset.length,
        ledgerEntries: ledgerEntries.recordset.length,
        pendingOutboxEvents: outboxEvents.recordset.filter((event) => event.status === "pending").length,
        auditEvents: auditLogs.recordset.length
      }
    };
  }

  async findTenantByExternalId(externalId: string): Promise<TenantRow | null> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("externalId", sql.NVarChar(64), externalId)
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

    const webhook = await this.findWebhookEndpoint(tenant.id, "whk_demo_ops");
    if (!webhook) {
      await this.createWebhookEndpoint({
        tenantExternalId: tenant.external_id,
        externalId: "whk_demo_ops",
        url: "https://webhooks.example.com/paymentops/events",
        description: "Demo operations webhook endpoint",
        secretHash: "seeded-webhook-secret-hash",
        eventSubscriptions: ["payout.created.v1", "payout.settled.v1", "webhook.dead_lettered.v1"]
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
      )
      .query(`
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

  private async requireTenant(externalId: string): Promise<TenantRow> {
    const tenant = await this.findTenantByExternalId(externalId);

    if (!tenant) {
      throw new NotFoundException(`Tenant ${externalId} was not found`);
    }

    return tenant;
  }

  private async requireTenantById(id: string): Promise<TenantRow> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query<TenantRow>(`
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
      .input("externalId", sql.NVarChar(64), externalId)
      .query<ApiClientRow>(`
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
      .input("externalId", sql.NVarChar(64), externalId)
      .query<ApiKeyRow>(`
SELECT id, external_id, name, key_prefix, permissions_json, expires_at, created_at
FROM dbo.api_keys
WHERE tenant_id = @tenantId AND external_id = @externalId;
`);

    return result.recordset[0] ?? null;
  }

  private async findWebhookEndpoint(
    tenantId: string,
    externalId: string
  ): Promise<WebhookEndpointRow | null> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenantId)
      .input("externalId", sql.NVarChar(64), externalId)
      .query<WebhookEndpointRow>(`
SELECT id, external_id, url, description, event_subscriptions_json, status, created_at
FROM dbo.webhook_endpoints
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
    .input("metadataJson", sql.NVarChar(sql.MAX), JSON.stringify(input.metadata))
    .query(`
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
