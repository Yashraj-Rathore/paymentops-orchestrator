import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { WebhookDeliverySummary } from "@paymentops/contracts";
import sql from "mssql";

import { DatabaseService } from "../database/database.service.js";

interface TenantRow {
  id: string;
  external_id: string;
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

@Injectable()
export class WebhookDeliveriesRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listTenantDeliveries(tenantExternalId: string): Promise<WebhookDeliverySummary[]> {
    const tenant = await this.requireTenant(tenantExternalId);
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<WebhookDeliveryRow>(`
SELECT TOP 50
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

    return result.recordset.map(mapWebhookDelivery);
  }

  async replayDelivery(tenantExternalId: string, deliveryExternalId: string): Promise<WebhookDeliverySummary> {
    const tenant = await this.requireTenant(tenantExternalId);
    const pool = await this.database.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const existing = await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("deliveryExternalId", sql.NVarChar(64), deliveryExternalId)
        .query<{ id: string; status: WebhookDeliverySummary["status"] }>(`
SELECT id, status
FROM dbo.webhook_deliveries
WHERE tenant_id = @tenantId AND external_id = @deliveryExternalId;
`);

      const delivery = existing.recordset[0];

      if (!delivery) {
        throw new NotFoundException(`Webhook delivery ${deliveryExternalId} was not found`);
      }

      if (delivery.status !== "failed" && delivery.status !== "dead_letter") {
        throw new ConflictException("Only failed or dead-lettered webhook deliveries can be replayed");
      }

      await new sql.Request(transaction)
        .input("deliveryId", sql.UniqueIdentifier, delivery.id)
        .query(`
UPDATE dbo.webhook_deliveries
SET status = N'pending',
    attempts = 0,
    next_attempt_at = SYSUTCDATETIME(),
    last_attempted_at = NULL,
    delivered_at = NULL,
    last_error = NULL,
    last_status_code = NULL,
    queue_job_id = NULL,
    queued_at = NULL,
    updated_at = SYSUTCDATETIME()
WHERE id = @deliveryId;
`);

      await insertAuditLog(transaction, {
        tenantId: tenant.id,
        action: "webhook_delivery.replayed",
        resourceType: "webhook_delivery",
        resourceId: deliveryExternalId,
        metadata: { deliveryId: deliveryExternalId }
      });

      const updated = await selectDelivery(transaction, tenant.id, deliveryExternalId);
      await transaction.commit();
      return updated;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private async requireTenant(externalId: string): Promise<TenantRow> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("externalId", sql.NVarChar(64), externalId)
      .query<TenantRow>(`
SELECT id, external_id
FROM dbo.tenants
WHERE external_id = @externalId;
`);

    const tenant = result.recordset[0];

    if (!tenant) {
      throw new NotFoundException(`Tenant ${externalId} was not found`);
    }

    return tenant;
  }
}

async function selectDelivery(
  transaction: sql.Transaction,
  tenantId: string,
  deliveryExternalId: string
): Promise<WebhookDeliverySummary> {
  const result = await new sql.Request(transaction)
    .input("tenantId", sql.UniqueIdentifier, tenantId)
    .input("deliveryExternalId", sql.NVarChar(64), deliveryExternalId)
    .query<WebhookDeliveryRow>(`
SELECT
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
WHERE webhook_deliveries.tenant_id = @tenantId AND webhook_deliveries.external_id = @deliveryExternalId;
`);

  const delivery = result.recordset[0];

  if (!delivery) {
    throw new NotFoundException(`Webhook delivery ${deliveryExternalId} was not found`);
  }

  return mapWebhookDelivery(delivery);
}

async function insertAuditLog(
  transaction: sql.Transaction,
  input: {
    tenantId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  await new sql.Request(transaction)
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
