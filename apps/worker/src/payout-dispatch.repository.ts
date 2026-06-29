import { Inject, Injectable } from "@nestjs/common";
import type { PayoutStatus } from "@paymentops/contracts";
import sql from "mssql";

import { WorkerDatabaseService } from "./worker-database.service.js";

export interface PendingPayoutDispatch {
  outboxEventId: string;
  tenantId: string;
  tenantExternalId: string;
  payoutId: string;
  payoutExternalId: string;
  providerPayoutId: string | null;
  status: PayoutStatus;
  amountMinor: number;
  currency: string;
  destinationAccount: string;
}

export interface DispatchSucceededInput {
  payoutId: string;
  payoutExternalId: string;
  tenantId: string;
  tenantExternalId: string;
  previousStatus: PayoutStatus;
  providerPayoutId: string;
}

@Injectable()
export class PayoutDispatchRepository {
  constructor(@Inject(WorkerDatabaseService) private readonly database: WorkerDatabaseService) {}

  async findDispatchByOutboxEventId(outboxEventId: string): Promise<PendingPayoutDispatch | null> {
    const pool = await this.database.connect();
    const result = await pool.request().input("outboxEventId", sql.UniqueIdentifier, outboxEventId)
      .query<PendingPayoutDispatchRow>(`
SELECT
  CONVERT(NVARCHAR(36), outbox_events.id) AS outbox_event_id,
  payouts.tenant_id,
  tenants.external_id AS tenant_external_id,
  payouts.id AS payout_id,
  payouts.external_id AS payout_external_id,
  payouts.provider_payout_id,
  payouts.status,
  payouts.amount_minor,
  payouts.currency,
  payouts.destination_account
FROM dbo.outbox_events
INNER JOIN dbo.payouts ON payouts.external_id = outbox_events.aggregate_id
INNER JOIN dbo.tenants ON tenants.id = payouts.tenant_id
WHERE outbox_events.id = @outboxEventId
  AND outbox_events.event_type = N'payout.created.v1'
  AND outbox_events.aggregate_type = N'payout';
`);

    const row = result.recordset[0];

    return row
      ? {
          outboxEventId: row.outbox_event_id,
          tenantId: row.tenant_id,
          tenantExternalId: row.tenant_external_id,
          payoutId: row.payout_id,
          payoutExternalId: row.payout_external_id,
          providerPayoutId: row.provider_payout_id,
          status: row.status,
          amountMinor: Number(row.amount_minor),
          currency: row.currency.trim(),
          destinationAccount: row.destination_account
        }
      : null;
  }

  async markDispatchSucceeded(input: DispatchSucceededInput): Promise<void> {
    const pool = await this.database.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      if (input.previousStatus === "queued") {
        const updated = await new sql.Request(transaction)
          .input("payoutId", sql.UniqueIdentifier, input.payoutId)
          .input("providerPayoutId", sql.NVarChar(128), input.providerPayoutId).query<{
          id: string;
        }>(`
UPDATE dbo.payouts
SET status = N'processing',
    provider_payout_id = @providerPayoutId,
    dispatch_last_error = NULL,
    updated_at = SYSUTCDATETIME()
OUTPUT inserted.id
WHERE id = @payoutId AND status = N'queued';
`);

        if (updated.recordset.length > 0) {
          await new sql.Request(transaction)
            .input("tenantId", sql.UniqueIdentifier, input.tenantId)
            .input("payoutId", sql.UniqueIdentifier, input.payoutId)
            .input("fromStatus", sql.NVarChar(32), input.previousStatus)
            .input("toStatus", sql.NVarChar(32), "processing")
            .input("reason", sql.NVarChar(256), "submitted to provider simulator").query(`
INSERT INTO dbo.payout_status_history (tenant_id, payout_id, from_status, to_status, reason)
VALUES (@tenantId, @payoutId, @fromStatus, @toStatus, @reason);
`);

          await insertOutboxEvent(transaction, {
            tenantId: input.tenantId,
            eventType: "payout.processing.v1",
            aggregateId: input.payoutExternalId,
            payload: {
              payoutId: input.payoutExternalId,
              tenantId: input.tenantExternalId,
              providerPayoutId: input.providerPayoutId,
              status: "processing"
            }
          });
        }
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async recordDispatchFailure(input: {
    payoutId: string;
    payoutExternalId: string;
    tenantId: string;
    tenantExternalId: string;
    attemptNumber: number;
    error: string;
    deadLetter: boolean;
  }): Promise<void> {
    const pool = await this.database.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const updated = await new sql.Request(transaction)
        .input("payoutId", sql.UniqueIdentifier, input.payoutId)
        .input("attemptNumber", sql.Int, input.attemptNumber)
        .input("error", sql.NVarChar(1000), input.error)
        .input("deadLetter", sql.Bit, input.deadLetter).query<{ id: string }>(`
UPDATE dbo.payouts
SET dispatch_attempts = CASE
      WHEN dispatch_attempts < @attemptNumber THEN @attemptNumber
      ELSE dispatch_attempts
    END,
    dispatch_last_error = @error,
    dispatch_dead_lettered_at = CASE WHEN @deadLetter = 1 THEN SYSUTCDATETIME() ELSE NULL END,
    status = CASE WHEN @deadLetter = 1 THEN N'failed' ELSE status END,
    updated_at = SYSUTCDATETIME()
OUTPUT inserted.id
WHERE id = @payoutId AND status = N'queued';
`);

      if (input.deadLetter && updated.recordset.length > 0) {
        await new sql.Request(transaction)
          .input("tenantId", sql.UniqueIdentifier, input.tenantId)
          .input("payoutId", sql.UniqueIdentifier, input.payoutId)
          .input("reason", sql.NVarChar(256), "provider dispatch retry limit reached").query(`
INSERT INTO dbo.payout_status_history (tenant_id, payout_id, from_status, to_status, reason)
VALUES (@tenantId, @payoutId, N'queued', N'failed', @reason);
`);

        await insertOutboxEvent(transaction, {
          tenantId: input.tenantId,
          eventType: "payout.failed.v1",
          aggregateId: input.payoutExternalId,
          payload: {
            payoutId: input.payoutExternalId,
            tenantId: input.tenantExternalId,
            status: "failed",
            reason: "provider dispatch retry limit reached"
          }
        });

        await new sql.Request(transaction)
          .input("tenantId", sql.UniqueIdentifier, input.tenantId)
          .input("resourceId", sql.NVarChar(128), input.payoutExternalId)
          .input(
            "metadataJson",
            sql.NVarChar(sql.MAX),
            JSON.stringify({ attempts: input.attemptNumber, error: input.error })
          ).query(`
INSERT INTO dbo.audit_logs (
  tenant_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json
)
VALUES (
  @tenantId, N'system', N'paymentops-worker', N'payout.dispatch_dead_lettered',
  N'payout', @resourceId, @metadataJson
);
`);
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

async function insertOutboxEvent(
  transaction: sql.Transaction,
  input: {
    tenantId: string;
    eventType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  await new sql.Request(transaction)
    .input("tenantId", sql.UniqueIdentifier, input.tenantId)
    .input("eventType", sql.NVarChar(128), input.eventType)
    .input("aggregateType", sql.NVarChar(64), "payout")
    .input("aggregateId", sql.NVarChar(64), input.aggregateId)
    .input("payloadJson", sql.NVarChar(sql.MAX), JSON.stringify(input.payload)).query(`
INSERT INTO dbo.outbox_events (tenant_id, event_type, aggregate_type, aggregate_id, payload_json)
VALUES (@tenantId, @eventType, @aggregateType, @aggregateId, @payloadJson);
`);
}

interface PendingPayoutDispatchRow {
  outbox_event_id: string;
  tenant_id: string;
  tenant_external_id: string;
  payout_id: string;
  payout_external_id: string;
  provider_payout_id: string | null;
  status: PayoutStatus;
  amount_minor: number | string;
  currency: string;
  destination_account: string;
}
