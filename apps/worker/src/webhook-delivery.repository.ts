import { Inject, Injectable } from "@nestjs/common";
import type { WebhookDeliveryStatus } from "@paymentops/contracts";
import sql from "mssql";

import { WorkerDatabaseService } from "./worker-database.service.js";

export interface PendingWebhookDelivery {
  deliveryId: string;
  deliveryExternalId: string;
  webhookEndpointExternalId: string;
  outboxEventId: string;
  tenantId: string;
  tenantExternalId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payloadJson: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  url: string;
  signingSecret: string;
  createdAt: Date;
}

export interface WebhookDeliverySuccessInput {
  deliveryId: string;
  attemptNumber: number;
  statusCode: number;
  responseBody: string | null;
  durationMs: number;
}

export interface WebhookDeliveryFailureInput {
  deliveryId: string;
  deliveryExternalId: string;
  tenantId: string;
  eventType: string;
  attemptNumber: number;
  statusCode: number | null;
  responseBody: string | null;
  errorMessage: string;
  durationMs: number;
  nextAttemptAt: Date | null;
  deadLetter: boolean;
}

@Injectable()
export class WebhookDeliveryRepository {
  constructor(@Inject(WorkerDatabaseService) private readonly database: WorkerDatabaseService) {}

  async scheduleMissingDeliveries(limit = 25): Promise<number> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("limit", sql.Int, limit)
      .query<{ external_id: string }>(`
INSERT INTO dbo.webhook_deliveries (
  external_id,
  tenant_id,
  webhook_endpoint_id,
  outbox_event_id,
  event_type,
  aggregate_type,
  aggregate_id,
  payload_json
)
OUTPUT inserted.external_id
SELECT TOP (@limit)
  CONCAT(N'whd_', REPLACE(CONVERT(NVARCHAR(36), NEWID()), N'-', N'')) AS external_id,
  outbox_events.tenant_id,
  webhook_endpoints.id,
  outbox_events.id,
  outbox_events.event_type,
  outbox_events.aggregate_type,
  outbox_events.aggregate_id,
  outbox_events.payload_json
FROM dbo.outbox_events
INNER JOIN dbo.webhook_endpoints ON webhook_endpoints.tenant_id = outbox_events.tenant_id
WHERE webhook_endpoints.status = N'active'
  AND webhook_endpoints.signing_secret IS NOT NULL
  AND webhook_endpoints.created_at <= outbox_events.created_at
  AND outbox_events.event_type LIKE N'payout.%'
  AND EXISTS (
    SELECT 1
    FROM OPENJSON(webhook_endpoints.event_subscriptions_json)
    WHERE [value] = outbox_events.event_type OR [value] = N'*'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM dbo.webhook_deliveries
    WHERE webhook_deliveries.webhook_endpoint_id = webhook_endpoints.id
      AND webhook_deliveries.outbox_event_id = outbox_events.id
  )
ORDER BY outbox_events.created_at ASC;
`);

    return result.recordset.length;
  }

  async findSendableDeliveries(limit = 10): Promise<PendingWebhookDelivery[]> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("limit", sql.Int, limit)
      .query<PendingWebhookDeliveryRow>(`
SELECT TOP (@limit)
  webhook_deliveries.id AS delivery_id,
  webhook_deliveries.external_id AS delivery_external_id,
  webhook_endpoints.external_id AS webhook_endpoint_external_id,
  CONVERT(NVARCHAR(36), webhook_deliveries.outbox_event_id) AS outbox_event_id,
  webhook_deliveries.tenant_id,
  tenants.external_id AS tenant_external_id,
  webhook_deliveries.event_type,
  webhook_deliveries.aggregate_type,
  webhook_deliveries.aggregate_id,
  webhook_deliveries.payload_json,
  webhook_deliveries.status,
  webhook_deliveries.attempts,
  webhook_endpoints.url,
  webhook_endpoints.signing_secret,
  webhook_deliveries.created_at
FROM dbo.webhook_deliveries
INNER JOIN dbo.webhook_endpoints ON webhook_endpoints.id = webhook_deliveries.webhook_endpoint_id
INNER JOIN dbo.tenants ON tenants.id = webhook_deliveries.tenant_id
WHERE webhook_deliveries.status IN (N'pending', N'failed')
  AND webhook_endpoints.status = N'active'
  AND webhook_deliveries.next_attempt_at <= SYSUTCDATETIME()
ORDER BY webhook_deliveries.next_attempt_at ASC, webhook_deliveries.created_at ASC;
`);

    return result.recordset.map((row) => ({
      deliveryId: row.delivery_id,
      deliveryExternalId: row.delivery_external_id,
      webhookEndpointExternalId: row.webhook_endpoint_external_id,
      outboxEventId: row.outbox_event_id,
      tenantId: row.tenant_id,
      tenantExternalId: row.tenant_external_id,
      eventType: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payloadJson: row.payload_json,
      status: row.status,
      attempts: row.attempts,
      url: row.url,
      signingSecret: row.signing_secret,
      createdAt: row.created_at
    }));
  }

  async recordDeliverySucceeded(input: WebhookDeliverySuccessInput): Promise<void> {
    const pool = await this.database.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      await new sql.Request(transaction)
        .input("deliveryId", sql.UniqueIdentifier, input.deliveryId)
        .input("attemptNumber", sql.Int, input.attemptNumber)
        .input("statusCode", sql.Int, input.statusCode)
        .input("responseBody", sql.NVarChar(2000), input.responseBody)
        .input("durationMs", sql.Int, input.durationMs)
        .query(`
INSERT INTO dbo.webhook_delivery_attempts (
  webhook_delivery_id,
  attempt_number,
  status_code,
  response_body,
  error_message,
  duration_ms
)
VALUES (@deliveryId, @attemptNumber, @statusCode, @responseBody, NULL, @durationMs);
`);

      await new sql.Request(transaction)
        .input("deliveryId", sql.UniqueIdentifier, input.deliveryId)
        .input("attemptNumber", sql.Int, input.attemptNumber)
        .input("statusCode", sql.Int, input.statusCode)
        .query(`
UPDATE dbo.webhook_deliveries
SET status = N'delivered',
    attempts = @attemptNumber,
    last_attempted_at = SYSUTCDATETIME(),
    delivered_at = SYSUTCDATETIME(),
    next_attempt_at = NULL,
    last_status_code = @statusCode,
    last_error = NULL,
    updated_at = SYSUTCDATETIME()
WHERE id = @deliveryId;
`);

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async recordDeliveryFailed(input: WebhookDeliveryFailureInput): Promise<void> {
    const pool = await this.database.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      await new sql.Request(transaction)
        .input("deliveryId", sql.UniqueIdentifier, input.deliveryId)
        .input("attemptNumber", sql.Int, input.attemptNumber)
        .input("statusCode", sql.Int, input.statusCode)
        .input("responseBody", sql.NVarChar(2000), input.responseBody)
        .input("errorMessage", sql.NVarChar(1000), input.errorMessage)
        .input("durationMs", sql.Int, input.durationMs)
        .query(`
INSERT INTO dbo.webhook_delivery_attempts (
  webhook_delivery_id,
  attempt_number,
  status_code,
  response_body,
  error_message,
  duration_ms
)
VALUES (@deliveryId, @attemptNumber, @statusCode, @responseBody, @errorMessage, @durationMs);
`);

      await new sql.Request(transaction)
        .input("deliveryId", sql.UniqueIdentifier, input.deliveryId)
        .input("attemptNumber", sql.Int, input.attemptNumber)
        .input("status", sql.NVarChar(32), input.deadLetter ? "dead_letter" : "failed")
        .input("nextAttemptAt", sql.DateTime2, input.nextAttemptAt)
        .input("statusCode", sql.Int, input.statusCode)
        .input("errorMessage", sql.NVarChar(1000), input.errorMessage)
        .query(`
UPDATE dbo.webhook_deliveries
SET status = @status,
    attempts = @attemptNumber,
    last_attempted_at = SYSUTCDATETIME(),
    next_attempt_at = @nextAttemptAt,
    last_status_code = @statusCode,
    last_error = @errorMessage,
    updated_at = SYSUTCDATETIME()
WHERE id = @deliveryId;
`);

      if (input.deadLetter) {
        await new sql.Request(transaction)
          .input("tenantId", sql.UniqueIdentifier, input.tenantId)
          .input("eventType", sql.NVarChar(128), "webhook.dead_lettered.v1")
          .input("aggregateType", sql.NVarChar(64), "webhook_delivery")
          .input("aggregateId", sql.NVarChar(64), input.deliveryExternalId)
          .input(
            "payloadJson",
            sql.NVarChar(sql.MAX),
            JSON.stringify({
              deliveryId: input.deliveryExternalId,
              eventType: input.eventType,
              attempts: input.attemptNumber,
              error: input.errorMessage
            })
          )
          .query(`
INSERT INTO dbo.outbox_events (tenant_id, event_type, aggregate_type, aggregate_id, payload_json)
VALUES (@tenantId, @eventType, @aggregateType, @aggregateId, @payloadJson);
`);

        await new sql.Request(transaction)
          .input("tenantId", sql.UniqueIdentifier, input.tenantId)
          .input("actorType", sql.NVarChar(64), "system")
          .input("actorId", sql.NVarChar(256), "paymentops-worker")
          .input("action", sql.NVarChar(128), "webhook_delivery.dead_lettered")
          .input("resourceType", sql.NVarChar(128), "webhook_delivery")
          .input("resourceId", sql.NVarChar(128), input.deliveryExternalId)
          .input("metadataJson", sql.NVarChar(sql.MAX), JSON.stringify({ eventType: input.eventType }))
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

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

interface PendingWebhookDeliveryRow {
  delivery_id: string;
  delivery_external_id: string;
  webhook_endpoint_external_id: string;
  outbox_event_id: string;
  tenant_id: string;
  tenant_external_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  url: string;
  signing_secret: string;
  created_at: Date;
}
