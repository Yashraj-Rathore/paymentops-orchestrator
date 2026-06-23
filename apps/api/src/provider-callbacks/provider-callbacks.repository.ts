import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PayoutStatus, ProviderPayoutCallbackResponse } from "@paymentops/contracts";
import sql from "mssql";

import { DatabaseService } from "../database/database.service.js";

interface PayoutCallbackRow {
  id: string;
  external_id: string;
  provider_payout_id: string | null;
  status: PayoutStatus;
  tenant_id: string;
  tenant_external_id: string;
}

interface ApplyCallbackInput {
  payoutId: string;
  tenantId: string;
  providerPayoutId: string;
  status: "paid" | "failed";
  reason: string;
}

@Injectable()
export class ProviderCallbacksRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async applyPayoutCallback(input: ApplyCallbackInput): Promise<ProviderPayoutCallbackResponse> {
    const pool = await this.database.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const result = await new sql.Request(transaction)
        .input("payoutId", sql.NVarChar(64), input.payoutId)
        .input("tenantExternalId", sql.NVarChar(64), input.tenantId)
        .query<PayoutCallbackRow>(`
SELECT TOP 1
  payouts.id,
  payouts.external_id,
  payouts.provider_payout_id,
  payouts.status,
  payouts.tenant_id,
  tenants.external_id AS tenant_external_id
FROM dbo.payouts
INNER JOIN dbo.tenants ON tenants.id = payouts.tenant_id
WHERE payouts.external_id = @payoutId AND tenants.external_id = @tenantExternalId;
`);

      const payout = result.recordset[0];

      if (!payout) {
        throw new NotFoundException(`Payout ${input.payoutId} was not found`);
      }

      if (payout.provider_payout_id && payout.provider_payout_id !== input.providerPayoutId) {
        throw new ConflictException("Provider payout id does not match the payout record");
      }

      if (payout.status === "paid" || payout.status === "failed" || payout.status === "canceled") {
        await transaction.commit();
        return {
          payoutId: payout.external_id,
          status: payout.status,
          accepted: false
        };
      }

      await new sql.Request(transaction)
        .input("payoutId", sql.UniqueIdentifier, payout.id)
        .input("providerPayoutId", sql.NVarChar(128), input.providerPayoutId)
        .input("status", sql.NVarChar(32), input.status)
        .query(`
UPDATE dbo.payouts
SET status = @status,
    provider_payout_id = COALESCE(provider_payout_id, @providerPayoutId),
    updated_at = SYSUTCDATETIME()
WHERE id = @payoutId;
`);

      await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, payout.tenant_id)
        .input("payoutId", sql.UniqueIdentifier, payout.id)
        .input("fromStatus", sql.NVarChar(32), payout.status)
        .input("toStatus", sql.NVarChar(32), input.status)
        .input("reason", sql.NVarChar(256), input.reason)
        .query(`
INSERT INTO dbo.payout_status_history (tenant_id, payout_id, from_status, to_status, reason)
VALUES (@tenantId, @payoutId, @fromStatus, @toStatus, @reason);
`);

      await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, payout.tenant_id)
        .input("eventType", sql.NVarChar(128), `payout.${input.status}.v1`)
        .input("aggregateType", sql.NVarChar(64), "payout")
        .input("aggregateId", sql.NVarChar(64), payout.external_id)
        .input(
          "payloadJson",
          sql.NVarChar(sql.MAX),
          JSON.stringify({
            payoutId: payout.external_id,
            tenantId: payout.tenant_external_id,
            providerPayoutId: input.providerPayoutId,
            status: input.status,
            reason: input.reason
          })
        )
        .query(`
INSERT INTO dbo.outbox_events (tenant_id, event_type, aggregate_type, aggregate_id, payload_json)
VALUES (@tenantId, @eventType, @aggregateType, @aggregateId, @payloadJson);
`);

      await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, payout.tenant_id)
        .input("actorType", sql.NVarChar(64), "provider")
        .input("actorId", sql.NVarChar(256), input.providerPayoutId)
        .input("action", sql.NVarChar(128), `payout.${input.status}`)
        .input("resourceType", sql.NVarChar(128), "payout")
        .input("resourceId", sql.NVarChar(128), payout.external_id)
        .input("metadataJson", sql.NVarChar(sql.MAX), JSON.stringify({ reason: input.reason }))
        .query(`
INSERT INTO dbo.audit_logs (tenant_id, actor_type, actor_id, action, resource_type, resource_id, metadata_json)
VALUES (@tenantId, @actorType, @actorId, @action, @resourceType, @resourceId, @metadataJson);
`);

      await transaction.commit();

      return {
        payoutId: payout.external_id,
        status: input.status,
        accepted: true
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
