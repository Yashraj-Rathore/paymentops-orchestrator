import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AuthPrincipalType,
  ReconciliationDiscrepancySummary,
  ReconciliationImportDetails,
  ReconciliationImportSummary,
  SettlementMatchStatus,
  SettlementRowSummary
} from "@paymentops/contracts";
import { randomBytes } from "node:crypto";
import sql from "mssql";

import { DatabaseService } from "../database/database.service.js";

interface TenantRow {
  id: string;
  external_id: string;
}

interface ImportRow {
  id: string;
  external_id: string;
  provider_name: string;
  file_name: string;
  status: ReconciliationImportSummary["status"];
  row_count: number;
  matched_count: number;
  discrepancy_count: number;
  imported_by_actor_id: string;
  created_at: Date;
  completed_at: Date | null;
}

interface PayoutMatchRow {
  id: string;
  external_id: string;
  amount_minor: number | string;
  currency: string;
}

interface SettlementRowRecord {
  row_id: string;
  provider_payout_id: string;
  payout_external_id: string | null;
  amount_minor: number | string;
  currency: string;
  provider_status: string;
  settled_at: Date | null;
  match_status: SettlementMatchStatus;
}

interface DiscrepancyRow {
  external_id: string;
  settlement_row_id: string;
  provider_payout_id: string;
  payout_external_id: string | null;
  discrepancy_type: ReconciliationDiscrepancySummary["type"];
  status: ReconciliationDiscrepancySummary["status"];
  expected_amount_minor: number | string | null;
  actual_amount_minor: number | string;
  expected_currency: string | null;
  actual_currency: string;
  created_at: Date;
  resolved_at: Date | null;
}

export interface SettlementImportRowInput {
  providerPayoutId: string;
  amountMinor: number;
  currency: string;
  providerStatus: string;
  settledAt: Date | null;
}

export interface CreateSettlementImportInput {
  tenantExternalId: string;
  externalId: string;
  providerName: string;
  fileName: string;
  fileSha256: string;
  actorType: AuthPrincipalType;
  actorId: string;
  rows: SettlementImportRowInput[];
}

@Injectable()
export class ReconciliationRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listImports(tenantExternalId: string): Promise<ReconciliationImportSummary[]> {
    const tenant = await this.requireTenant(tenantExternalId);
    const pool = await this.database.connect();
    const result = await pool.request().input("tenantId", sql.UniqueIdentifier, tenant.id)
      .query<ImportRow>(`
SELECT TOP 20
  id,
  external_id,
  provider_name,
  file_name,
  status,
  row_count,
  matched_count,
  discrepancy_count,
  imported_by_actor_id,
  created_at,
  completed_at
FROM dbo.settlement_imports
WHERE tenant_id = @tenantId
ORDER BY created_at DESC;
`);

    return result.recordset.map((row) => mapImport(row, tenant.external_id));
  }

  async getImport(
    tenantExternalId: string,
    importExternalId: string
  ): Promise<ReconciliationImportDetails> {
    const tenant = await this.requireTenant(tenantExternalId);
    const pool = await this.database.connect();
    const importResult = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("importExternalId", sql.NVarChar(64), importExternalId).query<ImportRow>(`
SELECT
  id,
  external_id,
  provider_name,
  file_name,
  status,
  row_count,
  matched_count,
  discrepancy_count,
  imported_by_actor_id,
  created_at,
  completed_at
FROM dbo.settlement_imports
WHERE tenant_id = @tenantId
  AND external_id = @importExternalId;
`);
    const importRow = importResult.recordset[0];

    if (!importRow) {
      throw new NotFoundException("Reconciliation import " + importExternalId + " was not found");
    }

    const rows = await pool.request().input("importId", sql.UniqueIdentifier, importRow.id)
      .query<SettlementRowRecord>(`
SELECT
  CONVERT(NVARCHAR(36), settlement_rows.id) AS row_id,
  settlement_rows.provider_payout_id,
  payouts.external_id AS payout_external_id,
  settlement_rows.amount_minor,
  settlement_rows.currency,
  settlement_rows.provider_status,
  settlement_rows.settled_at,
  settlement_rows.match_status
FROM dbo.settlement_rows
LEFT JOIN dbo.payouts ON payouts.id = settlement_rows.payout_id
WHERE settlement_rows.settlement_import_id = @importId
ORDER BY settlement_rows.created_at ASC;
`);

    const discrepancies = await pool.request().input("importId", sql.UniqueIdentifier, importRow.id)
      .query<DiscrepancyRow>(`
SELECT
  reconciliation_discrepancies.external_id,
  CONVERT(NVARCHAR(36), reconciliation_discrepancies.settlement_row_id) AS settlement_row_id,
  settlement_rows.provider_payout_id,
  payouts.external_id AS payout_external_id,
  reconciliation_discrepancies.discrepancy_type,
  reconciliation_discrepancies.status,
  reconciliation_discrepancies.expected_amount_minor,
  reconciliation_discrepancies.actual_amount_minor,
  reconciliation_discrepancies.expected_currency,
  reconciliation_discrepancies.actual_currency,
  reconciliation_discrepancies.created_at,
  reconciliation_discrepancies.resolved_at
FROM dbo.reconciliation_discrepancies
INNER JOIN dbo.settlement_rows ON settlement_rows.id = reconciliation_discrepancies.settlement_row_id
LEFT JOIN dbo.payouts ON payouts.id = reconciliation_discrepancies.payout_id
WHERE reconciliation_discrepancies.settlement_import_id = @importId
ORDER BY reconciliation_discrepancies.created_at ASC;
`);

    return {
      ...mapImport(importRow, tenant.external_id),
      rows: rows.recordset.map(mapSettlementRow),
      discrepancies: discrepancies.recordset.map(mapDiscrepancy)
    };
  }

  async createImport(input: CreateSettlementImportInput): Promise<ReconciliationImportDetails> {
    const tenant = await this.requireTenant(input.tenantExternalId);
    const pool = await this.database.connect();
    const duplicate = await pool
      .request()
      .input("tenantId", sql.UniqueIdentifier, tenant.id)
      .input("fileSha256", sql.Char(64), input.fileSha256).query<{ external_id: string }>(`
SELECT external_id
FROM dbo.settlement_imports
WHERE tenant_id = @tenantId
  AND file_sha256 = @fileSha256;
`);

    if (duplicate.recordset[0]) {
      throw new ConflictException(
        "This settlement file was already imported as " + duplicate.recordset[0].external_id
      );
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const created = await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("externalId", sql.NVarChar(64), input.externalId)
        .input("providerName", sql.NVarChar(128), input.providerName)
        .input("fileName", sql.NVarChar(256), input.fileName)
        .input("fileSha256", sql.Char(64), input.fileSha256)
        .input("actorType", sql.NVarChar(64), input.actorType)
        .input("actorId", sql.NVarChar(256), input.actorId).query<{ id: string }>(`
INSERT INTO dbo.settlement_imports (
  tenant_id,
  external_id,
  provider_name,
  file_name,
  file_sha256,
  imported_by_actor_type,
  imported_by_actor_id
)
OUTPUT inserted.id
VALUES (
  @tenantId,
  @externalId,
  @providerName,
  @fileName,
  @fileSha256,
  @actorType,
  @actorId
);
`);
      const importId = created.recordset[0].id;
      let matchedCount = 0;
      let discrepancyCount = 0;

      for (const row of input.rows) {
        const payoutResult = await new sql.Request(transaction)
          .input("tenantId", sql.UniqueIdentifier, tenant.id)
          .input("providerPayoutId", sql.NVarChar(128), row.providerPayoutId)
          .query<PayoutMatchRow>(`
SELECT TOP 1 id, external_id, amount_minor, currency
FROM dbo.payouts
WHERE tenant_id = @tenantId
  AND provider_payout_id = @providerPayoutId;
`);
        const payout = payoutResult.recordset[0];
        const matchStatus = classifySettlementRow(payout, row);

        if (matchStatus === "matched") {
          matchedCount += 1;
        } else {
          discrepancyCount += 1;
        }

        const insertedRow = await new sql.Request(transaction)
          .input("tenantId", sql.UniqueIdentifier, tenant.id)
          .input("importId", sql.UniqueIdentifier, importId)
          .input("payoutId", sql.UniqueIdentifier, payout?.id ?? null)
          .input("providerPayoutId", sql.NVarChar(128), row.providerPayoutId)
          .input("amountMinor", sql.BigInt, row.amountMinor)
          .input("currency", sql.Char(3), row.currency)
          .input("providerStatus", sql.NVarChar(64), row.providerStatus)
          .input("settledAt", sql.DateTime2, row.settledAt)
          .input("matchStatus", sql.NVarChar(32), matchStatus).query<{ id: string }>(`
INSERT INTO dbo.settlement_rows (
  tenant_id,
  settlement_import_id,
  payout_id,
  provider_payout_id,
  amount_minor,
  currency,
  provider_status,
  settled_at,
  match_status
)
OUTPUT inserted.id
VALUES (
  @tenantId,
  @importId,
  @payoutId,
  @providerPayoutId,
  @amountMinor,
  @currency,
  @providerStatus,
  @settledAt,
  @matchStatus
);
`);

        if (matchStatus !== "matched") {
          await new sql.Request(transaction)
            .input("externalId", sql.NVarChar(64), externalId("rcd"))
            .input("tenantId", sql.UniqueIdentifier, tenant.id)
            .input("importId", sql.UniqueIdentifier, importId)
            .input("settlementRowId", sql.UniqueIdentifier, insertedRow.recordset[0].id)
            .input("payoutId", sql.UniqueIdentifier, payout?.id ?? null)
            .input("discrepancyType", sql.NVarChar(32), matchStatus)
            .input("expectedAmountMinor", sql.BigInt, payout ? Number(payout.amount_minor) : null)
            .input("actualAmountMinor", sql.BigInt, row.amountMinor)
            .input("expectedCurrency", sql.Char(3), payout?.currency.trim() ?? null)
            .input("actualCurrency", sql.Char(3), row.currency).query(`
INSERT INTO dbo.reconciliation_discrepancies (
  external_id,
  tenant_id,
  settlement_import_id,
  settlement_row_id,
  payout_id,
  discrepancy_type,
  expected_amount_minor,
  actual_amount_minor,
  expected_currency,
  actual_currency
)
VALUES (
  @externalId,
  @tenantId,
  @importId,
  @settlementRowId,
  @payoutId,
  @discrepancyType,
  @expectedAmountMinor,
  @actualAmountMinor,
  @expectedCurrency,
  @actualCurrency
);
`);
        }
      }

      await new sql.Request(transaction)
        .input("importId", sql.UniqueIdentifier, importId)
        .input("rowCount", sql.Int, input.rows.length)
        .input("matchedCount", sql.Int, matchedCount)
        .input("discrepancyCount", sql.Int, discrepancyCount).query(`
UPDATE dbo.settlement_imports
SET status = N'completed',
    row_count = @rowCount,
    matched_count = @matchedCount,
    discrepancy_count = @discrepancyCount,
    completed_at = SYSUTCDATETIME()
WHERE id = @importId;
`);

      const eventPayload = {
        reconciliationImportId: input.externalId,
        tenantId: tenant.external_id,
        providerName: input.providerName,
        fileName: input.fileName,
        rowCount: input.rows.length,
        matchedCount,
        discrepancyCount
      };

      await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("eventType", sql.NVarChar(128), "reconciliation.completed.v1")
        .input("aggregateType", sql.NVarChar(64), "reconciliation_import")
        .input("aggregateId", sql.NVarChar(64), input.externalId)
        .input("payloadJson", sql.NVarChar(sql.MAX), JSON.stringify(eventPayload)).query(`
INSERT INTO dbo.outbox_events (
  tenant_id,
  event_type,
  aggregate_type,
  aggregate_id,
  payload_json
)
VALUES (@tenantId, @eventType, @aggregateType, @aggregateId, @payloadJson);
`);

      await new sql.Request(transaction)
        .input("tenantId", sql.UniqueIdentifier, tenant.id)
        .input("actorType", sql.NVarChar(64), input.actorType)
        .input("actorId", sql.NVarChar(256), input.actorId)
        .input("action", sql.NVarChar(128), "reconciliation.imported")
        .input("resourceType", sql.NVarChar(128), "settlement_import")
        .input("resourceId", sql.NVarChar(128), input.externalId)
        .input("metadataJson", sql.NVarChar(sql.MAX), JSON.stringify(eventPayload)).query(`
INSERT INTO dbo.audit_logs (
  tenant_id,
  actor_type,
  actor_id,
  action,
  resource_type,
  resource_id,
  metadata_json
)
VALUES (
  @tenantId,
  @actorType,
  @actorId,
  @action,
  @resourceType,
  @resourceId,
  @metadataJson
);
`);

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    return this.getImport(input.tenantExternalId, input.externalId);
  }

  private async requireTenant(externalId: string): Promise<TenantRow> {
    const pool = await this.database.connect();
    const result = await pool.request().input("externalId", sql.NVarChar(64), externalId)
      .query<TenantRow>(`
SELECT id, external_id
FROM dbo.tenants
WHERE external_id = @externalId
  AND status = N'active';
`);
    const tenant = result.recordset[0];

    if (!tenant) {
      throw new NotFoundException("Tenant " + externalId + " was not found");
    }

    return tenant;
  }
}

export function classifySettlementRow(
  payout: PayoutMatchRow | undefined,
  row: SettlementImportRowInput
): SettlementMatchStatus {
  if (!payout) {
    return "missing";
  }

  if (Number(payout.amount_minor) !== row.amountMinor || payout.currency.trim() !== row.currency) {
    return "amount_mismatch";
  }

  return "matched";
}

function mapImport(row: ImportRow, tenantExternalId: string): ReconciliationImportSummary {
  return {
    id: row.external_id,
    tenantId: tenantExternalId,
    providerName: row.provider_name,
    fileName: row.file_name,
    status: row.status,
    rowCount: row.row_count,
    matchedCount: row.matched_count,
    discrepancyCount: row.discrepancy_count,
    importedBy: row.imported_by_actor_id,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null
  };
}

function mapSettlementRow(row: SettlementRowRecord): SettlementRowSummary {
  return {
    id: row.row_id,
    providerPayoutId: row.provider_payout_id,
    payoutId: row.payout_external_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency.trim(),
    providerStatus: row.provider_status,
    settledAt: row.settled_at?.toISOString() ?? null,
    matchStatus: row.match_status
  };
}

function mapDiscrepancy(row: DiscrepancyRow): ReconciliationDiscrepancySummary {
  return {
    id: row.external_id,
    settlementRowId: row.settlement_row_id,
    providerPayoutId: row.provider_payout_id,
    payoutId: row.payout_external_id,
    type: row.discrepancy_type,
    status: row.status,
    expectedAmountMinor:
      row.expected_amount_minor === null ? null : Number(row.expected_amount_minor),
    actualAmountMinor: Number(row.actual_amount_minor),
    expectedCurrency: row.expected_currency?.trim() ?? null,
    actualCurrency: row.actual_currency.trim(),
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null
  };
}

function externalId(prefix: string): string {
  return prefix + "_" + randomBytes(8).toString("hex");
}
