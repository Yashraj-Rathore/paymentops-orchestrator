import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ApprovalDecisionResponse,
  ApprovalStatus,
  AuthPrincipalType,
  PayoutApprovalSummary,
  PayoutStatus,
  PayoutSummary
} from "@paymentops/contracts";
import sql from "mssql";

import { DatabaseService } from "../database/database.service.js";

interface TenantRow {
  id: string;
  external_id: string;
}

interface ApprovalRow {
  approval_id: string;
  approval_external_id: string;
  approval_status: ApprovalStatus;
  risk_reason: string;
  risk_rule_external_id: string | null;
  decided_by_actor_id: string | null;
  decided_at: Date | null;
  requested_at: Date;
  payout_id: string;
  payout_external_id: string;
  provider_payout_id: string | null;
  amount_minor: number | string;
  currency: string;
  destination_account: string;
  reference: string | null;
  description: string | null;
  payout_status: PayoutStatus;
  payout_created_at: Date;
  payout_updated_at: Date;
}

export interface ApprovalDecisionInput {
  tenantExternalId: string;
  payoutExternalId: string;
  decision: "approved" | "rejected";
  decisionReason: string | null;
  actorType: AuthPrincipalType;
  actorId: string;
}

@Injectable()
export class ApprovalsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listApprovals(tenantExternalId: string): Promise<PayoutApprovalSummary[]> {
    const tenant = await this.requireTenant(tenantExternalId);
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<ApprovalRow>(
        approvalSelectSql(`
WHERE payout_approvals.tenant_id = @tenantId
ORDER BY CASE WHEN payout_approvals.status = N'pending' THEN 0 ELSE 1 END, payout_approvals.created_at DESC;
`)
      );

    return result.recordset.map((row) => mapApproval(row, tenant.external_id));
  }

  async decideApproval(input: ApprovalDecisionInput): Promise<ApprovalDecisionResponse> {
    const tenant = await this.requireTenant(input.tenantExternalId);
    const pool = await this.database.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const existing = await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("payoutExternalId", sql.NVarChar(64), input.payoutExternalId)
        .query<ApprovalRow>(
          approvalSelectSql(`
WHERE payout_approvals.tenant_id = @tenantId
  AND payouts.external_id = @payoutExternalId;
`)
        );

      const approval = existing.recordset[0];

      if (!approval) {
        throw new NotFoundException(`Approval for payout ${input.payoutExternalId} was not found`);
      }

      if (approval.approval_status !== "pending") {
        throw new ConflictException(`Approval is already ${approval.approval_status}`);
      }

      if (approval.payout_status !== "needs_approval") {
        throw new ConflictException(`Payout is ${approval.payout_status} and cannot be decided`);
      }

      const nextPayoutStatus: PayoutStatus = input.decision === "approved" ? "queued" : "canceled";
      const statusReason =
        input.decision === "approved"
          ? (input.decisionReason ?? "payout approved for provider dispatch")
          : (input.decisionReason ?? "payout rejected during approval");

      await new sql.Request(transaction)
        .input("payoutId", sql.UniqueIdentifier, approval.payout_id)
        .input("status", sql.NVarChar(32), nextPayoutStatus).query(`
UPDATE dbo.payouts
SET status = @status,
    updated_at = SYSUTCDATETIME()
WHERE id = @payoutId;
`);

      await new sql.Request(transaction)
        .input("approvalId", sql.UniqueIdentifier, approval.approval_id)
        .input("status", sql.NVarChar(32), input.decision)
        .input("actorType", sql.NVarChar(64), input.actorType)
        .input("actorId", sql.NVarChar(256), input.actorId)
        .input("decisionReason", sql.NVarChar(500), input.decisionReason).query(`
UPDATE dbo.payout_approvals
SET status = @status,
    decided_by_actor_type = @actorType,
    decided_by_actor_id = @actorId,
    decision_reason = @decisionReason,
    decided_at = SYSUTCDATETIME(),
    updated_at = SYSUTCDATETIME()
WHERE id = @approvalId;
`);

      await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("payoutId", sql.UniqueIdentifier, approval.payout_id)
        .input("fromStatus", sql.NVarChar(32), approval.payout_status)
        .input("toStatus", sql.NVarChar(32), nextPayoutStatus)
        .input("reason", sql.NVarChar(256), statusReason).query(`
INSERT INTO dbo.payout_status_history (tenant_id, payout_id, from_status, to_status, reason)
VALUES (@tenantId, @payoutId, @fromStatus, @toStatus, @reason);
`);

      if (input.decision === "approved") {
        await insertOutboxEvent(transaction, {
          tenantId: tenant.id,
          eventType: "payout.approved.v1",
          aggregateId: approval.payout_external_id,
          payload: approvalPayload(tenant.external_id, approval, "queued", input.decisionReason)
        });
        await insertOutboxEvent(transaction, {
          tenantId: tenant.id,
          eventType: "payout.created.v1",
          aggregateId: approval.payout_external_id,
          payload: approvalPayload(tenant.external_id, approval, "queued", input.decisionReason)
        });
      } else {
        await insertOutboxEvent(transaction, {
          tenantId: tenant.id,
          eventType: "payout.rejected.v1",
          aggregateId: approval.payout_external_id,
          payload: approvalPayload(tenant.external_id, approval, "canceled", input.decisionReason)
        });
      }

      await insertAuditLog(transaction, {
        tenantId: tenant.id,
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.decision === "approved" ? "payout.approved" : "payout.rejected",
        resourceType: "payout",
        resourceId: approval.payout_external_id,
        metadata: {
          approvalId: approval.approval_external_id,
          riskRuleId: approval.risk_rule_external_id,
          decisionReason: input.decisionReason
        }
      });

      const updated = await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("payoutExternalId", sql.NVarChar(64), input.payoutExternalId)
        .query<ApprovalRow>(
          approvalSelectSql(`
WHERE payout_approvals.tenant_id = @tenantId
  AND payouts.external_id = @payoutExternalId;
`)
        );

      const updatedApproval = updated.recordset[0];
      await transaction.commit();

      return {
        ...mapApproval(updatedApproval, tenant.external_id),
        payout: mapPayout(updatedApproval, tenant.external_id)
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private async requireTenant(externalId: string): Promise<TenantRow> {
    const pool = await this.database.connect();
    const result = await pool.request().input("externalId", sql.NVarChar(64), externalId)
      .query<TenantRow>(`
SELECT id, external_id
FROM dbo.tenants
WHERE external_id = @externalId AND status = N'active';
`);

    const tenant = result.recordset[0];

    if (!tenant) {
      throw new NotFoundException(`Tenant ${externalId} was not found`);
    }

    return tenant;
  }
}

function approvalSelectSql(whereClause: string): string {
  return `
SELECT
  payout_approvals.id AS approval_id,
  payout_approvals.external_id AS approval_external_id,
  payout_approvals.status AS approval_status,
  payout_approvals.risk_reason,
  risk_rules.external_id AS risk_rule_external_id,
  payout_approvals.decided_by_actor_id,
  payout_approvals.decided_at,
  payout_approvals.created_at AS requested_at,
  payouts.id AS payout_id,
  payouts.external_id AS payout_external_id,
  payouts.provider_payout_id,
  payouts.amount_minor,
  payouts.currency,
  payouts.destination_account,
  payouts.reference,
  payouts.description,
  payouts.status AS payout_status,
  payouts.created_at AS payout_created_at,
  payouts.updated_at AS payout_updated_at
FROM dbo.payout_approvals
INNER JOIN dbo.payouts ON payouts.id = payout_approvals.payout_id
LEFT JOIN dbo.risk_rules ON risk_rules.id = payout_approvals.risk_rule_id
${whereClause}`;
}

function approvalPayload(
  tenantExternalId: string,
  approval: ApprovalRow,
  status: PayoutStatus,
  decisionReason: string | null
): Record<string, unknown> {
  return {
    payoutId: approval.payout_external_id,
    tenantId: tenantExternalId,
    approvalId: approval.approval_external_id,
    amountMinor: Number(approval.amount_minor),
    currency: approval.currency.trim(),
    destinationAccount: approval.destination_account,
    status,
    riskRuleId: approval.risk_rule_external_id,
    riskReason: approval.risk_reason,
    decisionReason
  };
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

async function insertAuditLog(
  transaction: sql.Transaction,
  input: {
    tenantId: string;
    actorType: AuthPrincipalType;
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  await new sql.Request(transaction)
    .input("tenantId", sql.UniqueIdentifier, input.tenantId)
    .input("actorType", sql.NVarChar(64), input.actorType)
    .input("actorId", sql.NVarChar(256), input.actorId)
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

function mapApproval(row: ApprovalRow, tenantExternalId: string): PayoutApprovalSummary {
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

function mapPayout(row: ApprovalRow, tenantExternalId: string): PayoutSummary {
  return {
    id: row.payout_external_id,
    tenantId: tenantExternalId,
    providerPayoutId: row.provider_payout_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency.trim(),
    destinationAccount: row.destination_account,
    reference: row.reference,
    description: row.description,
    status: row.payout_status,
    createdAt: row.payout_created_at.toISOString(),
    updatedAt: row.payout_updated_at.toISOString()
  };
}
