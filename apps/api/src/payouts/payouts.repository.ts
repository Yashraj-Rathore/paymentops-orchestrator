import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreatePayoutResponse,
  LedgerEntrySummary,
  OutboxEventSummary,
  PayoutDetailsResponse,
  PayoutStatus,
  PayoutStatusHistorySummary,
  PayoutSummary
} from "@paymentops/contracts";
import sql from "mssql";

import { DatabaseService } from "../database/database.service.js";

interface TenantRow {
  id: string;
  external_id: string;
}

interface PayoutRow {
  id: string;
  external_id: string;
  provider_payout_id: string | null;
  amount_minor: number | string;
  currency: string;
  destination_account: string;
  reference: string | null;
  description: string | null;
  status: PayoutStatus;
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

interface PayoutStatusHistoryRow {
  id: number | string;
  from_status: PayoutStatus | null;
  to_status: PayoutStatus;
  reason: string | null;
  created_at: Date;
}

interface OutboxEventRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  status: "pending" | "published" | "failed" | "dead_letter";
  attempts: number;
  created_at: Date;
}

interface IdempotencyRow {
  request_hash: string;
  response_json: string;
}

interface RiskRuleRow {
  id: string;
  external_id: string;
  name: string;
  rule_type: "amount_threshold" | "blocked_destination";
  action: "require_approval";
  amount_minor: number | string | null;
  currency: string | null;
  destination_account: string | null;
}

interface RiskMatch {
  ruleId: string;
  ruleExternalId: string;
  reason: string;
}

export interface CreatePayoutInput {
  tenantExternalId: string;
  externalId: string;
  idempotencyKey: string;
  requestHash: string;
  amountMinor: number;
  currency: string;
  destinationAccount: string;
  reference: string | null;
  description: string | null;
  apiClientExternalId: string | null;
  apiKeyExternalId: string | null;
}

@Injectable()
export class PayoutsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResponse> {
    const tenant = await this.requireTenant(input.tenantExternalId);
    const pool = await this.database.connect();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const existingIdempotency = await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("idempotencyKey", sql.NVarChar(128), input.idempotencyKey).query<IdempotencyRow>(`
SELECT request_hash, response_json
FROM dbo.payout_idempotency_keys WITH (UPDLOCK, HOLDLOCK)
WHERE tenant_id = @tenantId AND idempotency_key = @idempotencyKey;
`);

      const existing = existingIdempotency.recordset[0];

      if (existing) {
        if (existing.request_hash !== input.requestHash) {
          throw new ConflictException(
            "Idempotency-Key has already been used with a different payout request"
          );
        }

        await new sql.Request(transaction)
          .input("tenantId", sql.UniqueIdentifier, tenant.id)
          .input("idempotencyKey", sql.NVarChar(128), input.idempotencyKey).query(`
UPDATE dbo.payout_idempotency_keys
SET last_seen_at = SYSUTCDATETIME()
WHERE tenant_id = @tenantId AND idempotency_key = @idempotencyKey;
`);

        const replayedResponse = JSON.parse(existing.response_json) as PayoutDetailsResponse;

        await transaction.commit();
        return {
          ...replayedResponse,
          idempotencyKey: input.idempotencyKey,
          replayed: true
        };
      }

      const riskMatch = await findMatchingRiskRule(transaction, tenant.id, input);
      const payoutStatus: PayoutStatus = riskMatch ? "needs_approval" : "queued";
      const lifecycleEventType = riskMatch ? "payout.approval_requested.v1" : "payout.created.v1";
      const lifecycleReason = riskMatch?.reason ?? "payout accepted by API";

      const payout = await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("externalId", sql.NVarChar(64), input.externalId)
        .input("amountMinor", sql.BigInt, input.amountMinor)
        .input("currency", sql.Char(3), input.currency)
        .input("destinationAccount", sql.NVarChar(256), input.destinationAccount)
        .input("reference", sql.NVarChar(128), input.reference)
        .input("description", sql.NVarChar(500), input.description)
        .input("status", sql.NVarChar(32), payoutStatus)
        .input("apiClientExternalId", sql.NVarChar(64), input.apiClientExternalId)
        .input("apiKeyExternalId", sql.NVarChar(64), input.apiKeyExternalId).query<PayoutRow>(`
INSERT INTO dbo.payouts (
  tenant_id,
  external_id,
  amount_minor,
  currency,
  destination_account,
  reference,
  description,
  status,
  api_client_external_id,
  api_key_external_id
)
OUTPUT
  inserted.id,
  inserted.external_id,
  inserted.provider_payout_id,
  inserted.amount_minor,
  inserted.currency,
  inserted.destination_account,
  inserted.reference,
  inserted.description,
  inserted.status,
  inserted.created_at,
  inserted.updated_at
VALUES (
  @tenantId,
  @externalId,
  @amountMinor,
  @currency,
  @destinationAccount,
  @reference,
  @description,
  @status,
  @apiClientExternalId,
  @apiKeyExternalId
);
`);

      const payoutRow = payout.recordset[0];

      const ledgerEntries = await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("payoutId", sql.UniqueIdentifier, payoutRow.id)
        .input("payoutExternalId", sql.NVarChar(64), payoutRow.external_id)
        .input("currency", sql.Char(3), payoutRow.currency)
        .input("amountMinor", sql.BigInt, payoutRow.amount_minor)
        .input("merchantDebitId", sql.NVarChar(64), `le_${payoutRow.external_id}_merchant`)
        .input("providerCreditId", sql.NVarChar(64), `le_${payoutRow.external_id}_provider`)
        .query<LedgerEntryRow>(`
INSERT INTO dbo.ledger_entries (
  tenant_id,
  payout_id,
  external_id,
  direction,
  account_name,
  amount_minor,
  currency
)
OUTPUT
  inserted.id,
  inserted.external_id,
  @payoutExternalId AS payout_external_id,
  inserted.direction,
  inserted.account_name,
  inserted.amount_minor,
  inserted.currency,
  inserted.created_at
VALUES
  (@tenantId, @payoutId, @merchantDebitId, N'debit', N'merchant_payable', @amountMinor, @currency),
  (@tenantId, @payoutId, @providerCreditId, N'credit', N'provider_clearing', @amountMinor, @currency);
`);

      const statusHistory = await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("payoutId", sql.UniqueIdentifier, payoutRow.id)
        .input("toStatus", sql.NVarChar(32), payoutRow.status)
        .input("reason", sql.NVarChar(256), lifecycleReason).query<PayoutStatusHistoryRow>(`
INSERT INTO dbo.payout_status_history (tenant_id, payout_id, from_status, to_status, reason)
OUTPUT inserted.id, inserted.from_status, inserted.to_status, inserted.reason, inserted.created_at
VALUES (@tenantId, @payoutId, NULL, @toStatus, @reason);
`);

      if (riskMatch) {
        await new sql.Request(transaction)
          .input("tenantId", sql.UniqueIdentifier, tenant.id)
          .input("payoutId", sql.UniqueIdentifier, payoutRow.id)
          .input("riskRuleId", sql.UniqueIdentifier, riskMatch.ruleId)
          .input("externalId", sql.NVarChar(64), approvalExternalId(payoutRow.external_id))
          .input("riskReason", sql.NVarChar(500), riskMatch.reason).query(`
INSERT INTO dbo.payout_approvals (tenant_id, payout_id, risk_rule_id, external_id, risk_reason)
VALUES (@tenantId, @payoutId, @riskRuleId, @externalId, @riskReason);
`);
      }

      const outboxEvents = await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("eventType", sql.NVarChar(128), lifecycleEventType)
        .input("aggregateType", sql.NVarChar(64), "payout")
        .input("aggregateId", sql.NVarChar(64), payoutRow.external_id)
        .input(
          "payloadJson",
          sql.NVarChar(sql.MAX),
          JSON.stringify({
            payoutId: payoutRow.external_id,
            tenantId: tenant.external_id,
            amountMinor: Number(payoutRow.amount_minor),
            currency: payoutRow.currency.trim(),
            status: payoutRow.status,
            riskRuleId: riskMatch?.ruleExternalId ?? null,
            riskReason: riskMatch?.reason ?? null
          })
        ).query<OutboxEventRow>(`
INSERT INTO dbo.outbox_events (tenant_id, event_type, aggregate_type, aggregate_id, payload_json)
OUTPUT inserted.id, inserted.event_type, inserted.aggregate_type, inserted.aggregate_id, inserted.status, inserted.attempts, inserted.created_at
VALUES (@tenantId, @eventType, @aggregateType, @aggregateId, @payloadJson);
`);

      await insertAuditLog(transaction, {
        tenantId: tenant.id,
        action: riskMatch ? "payout.approval_requested" : "payout.created",
        resourceType: "payout",
        resourceId: payoutRow.external_id,
        metadata: {
          amountMinor: Number(payoutRow.amount_minor),
          currency: payoutRow.currency.trim(),
          idempotencyKey: input.idempotencyKey,
          apiClientId: input.apiClientExternalId,
          riskRuleId: riskMatch?.ruleExternalId ?? null,
          riskReason: riskMatch?.reason ?? null
        }
      });

      const details: PayoutDetailsResponse = {
        ...mapPayout(payoutRow, tenant.external_id),
        ledgerEntries: ledgerEntries.recordset.map(mapLedgerEntry),
        statusHistory: statusHistory.recordset.map(mapStatusHistory),
        outboxEvents: outboxEvents.recordset.map(mapOutboxEvent)
      };

      await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("idempotencyKey", sql.NVarChar(128), input.idempotencyKey)
        .input("requestHash", sql.NVarChar(128), input.requestHash)
        .input("payoutId", sql.UniqueIdentifier, payoutRow.id)
        .input("responseJson", sql.NVarChar(sql.MAX), JSON.stringify(details)).query(`
INSERT INTO dbo.payout_idempotency_keys (
  tenant_id,
  idempotency_key,
  request_hash,
  payout_id,
  response_json
)
VALUES (@tenantId, @idempotencyKey, @requestHash, @payoutId, @responseJson);
`);

      await transaction.commit();

      return {
        ...details,
        idempotencyKey: input.idempotencyKey,
        replayed: false
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async listPayouts(tenantExternalId: string): Promise<PayoutSummary[]> {
    const tenant = await this.requireTenant(tenantExternalId);
    const pool = await this.database.connect();
    const result = await pool.request().input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<PayoutRow>(`
SELECT TOP 50
  id,
  external_id,
  provider_payout_id,
  amount_minor,
  currency,
  destination_account,
  reference,
  description,
  status,
  created_at,
  updated_at
FROM dbo.payouts
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    return result.recordset.map((row) => mapPayout(row, tenant.external_id));
  }

  async getPayout(
    tenantExternalId: string,
    payoutExternalId: string
  ): Promise<PayoutDetailsResponse> {
    const tenant = await this.requireTenant(tenantExternalId);
    return this.loadPayoutDetails(tenant, payoutExternalId);
  }

  private async loadPayoutDetails(
    tenant: TenantRow,
    payoutExternalId: string
  ): Promise<PayoutDetailsResponse> {
    const pool = await this.database.connect();
    const payout = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("payoutExternalId", sql.NVarChar(64), payoutExternalId).query<PayoutRow>(`
SELECT
  id,
  external_id,
  provider_payout_id,
  amount_minor,
  currency,
  destination_account,
  reference,
  description,
  status,
  created_at,
  updated_at
FROM dbo.payouts
WHERE tenant_id = @tenantId AND external_id = @payoutExternalId;
`);

    const payoutRow = payout.recordset[0];

    if (!payoutRow) {
      throw new NotFoundException(`Payout ${payoutExternalId} was not found`);
    }

    const ledgerEntries = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("payoutId", sql.UniqueIdentifier, payoutRow.id).query<LedgerEntryRow>(`
SELECT
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
WHERE ledger_entries.tenant_id = @tenantId AND ledger_entries.payout_id = @payoutId
ORDER BY ledger_entries.id ASC;
`);

    const statusHistory = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("payoutId", sql.UniqueIdentifier, payoutRow.id).query<PayoutStatusHistoryRow>(`
SELECT id, from_status, to_status, reason, created_at
FROM dbo.payout_status_history
WHERE tenant_id = @tenantId AND payout_id = @payoutId
ORDER BY created_at ASC, id ASC;
`);

    const outboxEvents = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("aggregateId", sql.NVarChar(64), payoutRow.external_id).query<OutboxEventRow>(`
SELECT id, event_type, aggregate_type, aggregate_id, status, attempts, created_at
FROM dbo.outbox_events
WHERE tenant_id = @tenantId AND aggregate_type = N'payout' AND aggregate_id = @aggregateId
ORDER BY created_at ASC;
`);

    return {
      ...mapPayout(payoutRow, tenant.external_id),
      ledgerEntries: ledgerEntries.recordset.map(mapLedgerEntry),
      statusHistory: statusHistory.recordset.map(mapStatusHistory),
      outboxEvents: outboxEvents.recordset.map(mapOutboxEvent)
    };
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

async function findMatchingRiskRule(
  transaction: sql.Transaction,
  tenantId: string,
  input: Pick<CreatePayoutInput, "amountMinor" | "currency" | "destinationAccount">
): Promise<RiskMatch | null> {
  const result = await new sql.Request(transaction).input(
    "tenantId",
    sql.UniqueIdentifier,
    tenantId
  ).query<RiskRuleRow>(`
SELECT id, external_id, name, rule_type, action, amount_minor, currency, destination_account
FROM dbo.risk_rules
WHERE status = N'active'
  AND action = N'require_approval'
  AND (tenant_id = @tenantId OR tenant_id IS NULL)
ORDER BY CASE WHEN tenant_id = @tenantId THEN 0 ELSE 1 END, created_at DESC;
`);

  for (const rule of result.recordset) {
    if (rule.rule_type === "amount_threshold" && matchesAmountThreshold(rule, input)) {
      const threshold = Number(rule.amount_minor);
      return {
        ruleId: rule.id,
        ruleExternalId: rule.external_id,
        reason: `Payout amount ${input.currency} ${input.amountMinor} meets approval threshold ${rule.currency?.trim() ?? input.currency} ${threshold}`
      };
    }

    if (
      rule.rule_type === "blocked_destination" &&
      matchesBlockedDestination(rule, input.destinationAccount)
    ) {
      return {
        ruleId: rule.id,
        ruleExternalId: rule.external_id,
        reason: `Destination account ${input.destinationAccount} requires manual approval`
      };
    }
  }

  return null;
}

function matchesAmountThreshold(
  rule: RiskRuleRow,
  input: Pick<CreatePayoutInput, "amountMinor" | "currency">
): boolean {
  if (rule.amount_minor === null) {
    return false;
  }

  const currency = rule.currency?.trim();
  return (
    input.amountMinor >= Number(rule.amount_minor) && (!currency || currency === input.currency)
  );
}

function matchesBlockedDestination(rule: RiskRuleRow, destinationAccount: string): boolean {
  return rule.destination_account?.toLowerCase() === destinationAccount.toLowerCase();
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
    .input("actorType", sql.NVarChar(64), "api_key")
    .input("actorId", sql.NVarChar(256), "merchant-api")
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

function approvalExternalId(payoutExternalId: string): string {
  return `apr_${payoutExternalId.replace(/^po_/, "")}`;
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

function mapStatusHistory(row: PayoutStatusHistoryRow): PayoutStatusHistorySummary {
  return {
    id: String(row.id),
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
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
