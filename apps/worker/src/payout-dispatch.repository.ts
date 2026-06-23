import { Inject, Injectable } from "@nestjs/common";
import type { PayoutStatus } from "@paymentops/contracts";
import sql from "mssql";

import { WorkerDatabaseService } from "./worker-database.service.js";

export interface PendingPayoutDispatch {
  outboxEventId: string;
  attempts: number;
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
  outboxEventId: string;
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

  async findPendingPayoutDispatches(limit = 5): Promise<PendingPayoutDispatch[]> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("limit", sql.Int, limit)
      .query<PendingPayoutDispatchRow>(`
SELECT TOP (@limit)
  outbox_events.id AS outbox_event_id,
  outbox_events.attempts,
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
WHERE outbox_events.status = N'pending'
  AND outbox_events.event_type = N'payout.created.v1'
  AND outbox_events.aggregate_type = N'payout'
ORDER BY outbox_events.created_at ASC;
`);

    return result.recordset.map((row) => ({
      outboxEventId: row.outbox_event_id,
      attempts: row.attempts,
      tenantId: row.tenant_id,
      tenantExternalId: row.tenant_external_id,
      payoutId: row.payout_id,
      payoutExternalId: row.payout_external_id,
      providerPayoutId: row.provider_payout_id,
      status: row.status,
      amountMinor: Number(row.amount_minor),
      currency: row.currency.trim(),
      destinationAccount: row.destination_account
    }));
  }

  async markDispatchSucceeded(input: DispatchSucceededInput): Promise<void> {
    const pool = await this.database.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      if (input.previousStatus === "queued") {
        await new sql.Request(transaction)
          .input("payoutId", sql.UniqueIdentifier, input.payoutId)
          .input("providerPayoutId", sql.NVarChar(128), input.providerPayoutId)
          .query(`
UPDATE dbo.payouts
SET status = N'processing',
    provider_payout_id = @providerPayoutId,
    updated_at = SYSUTCDATETIME()
WHERE id = @payoutId;
`);

        await new sql.Request(transaction)
          .input("tenantId", sql.UniqueIdentifier, input.tenantId)
          .input("payoutId", sql.UniqueIdentifier, input.payoutId)
          .input("fromStatus", sql.NVarChar(32), input.previousStatus)
          .input("toStatus", sql.NVarChar(32), "processing")
          .input("reason", sql.NVarChar(256), "submitted to provider simulator")
          .query(`
INSERT INTO dbo.payout_status_history (tenant_id, payout_id, from_status, to_status, reason)
VALUES (@tenantId, @payoutId, @fromStatus, @toStatus, @reason);
`);

        await new sql.Request(transaction)
          .input("tenantId", sql.UniqueIdentifier, input.tenantId)
          .input("eventType", sql.NVarChar(128), "payout.processing.v1")
          .input("aggregateType", sql.NVarChar(64), "payout")
          .input("aggregateId", sql.NVarChar(64), input.payoutExternalId)
          .input(
            "payloadJson",
            sql.NVarChar(sql.MAX),
            JSON.stringify({
              payoutId: input.payoutExternalId,
              tenantId: input.tenantExternalId,
              providerPayoutId: input.providerPayoutId,
              status: "processing"
            })
          )
          .query(`
INSERT INTO dbo.outbox_events (tenant_id, event_type, aggregate_type, aggregate_id, payload_json)
VALUES (@tenantId, @eventType, @aggregateType, @aggregateId, @payloadJson);
`);
      }

      await new sql.Request(transaction)
        .input("outboxEventId", sql.UniqueIdentifier, input.outboxEventId)
        .query(`
UPDATE dbo.outbox_events
SET status = N'published',
    published_at = SYSUTCDATETIME()
WHERE id = @outboxEventId;
`);

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async markDispatchFailed(outboxEventId: string, maxAttempts: number): Promise<void> {
    const pool = await this.database.connect();
    await pool
      .request()
      .input("outboxEventId", sql.UniqueIdentifier, outboxEventId)
      .input("maxAttempts", sql.Int, maxAttempts)
      .query(`
UPDATE dbo.outbox_events
SET attempts = attempts + 1,
    status = CASE WHEN attempts + 1 >= @maxAttempts THEN N'dead_letter' ELSE N'pending' END
WHERE id = @outboxEventId;
`);
  }
}

interface PendingPayoutDispatchRow {
  outbox_event_id: string;
  attempts: number;
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
