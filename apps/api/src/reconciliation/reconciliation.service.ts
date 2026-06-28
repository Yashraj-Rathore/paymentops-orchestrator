import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type {
  AuthPrincipalType,
  CreateReconciliationImportRequest,
  ReconciliationImportDetails,
  ReconciliationImportSummary
} from "@paymentops/contracts";
import { recordPaymentOperation } from "@paymentops/observability";
import { parse } from "csv-parse/sync";
import { createHash, randomBytes } from "node:crypto";

import type { AuthenticatedPrincipal } from "../auth/auth.types.js";
import {
  ReconciliationRepository,
  type SettlementImportRowInput
} from "./reconciliation.repository.js";

const requiredColumns = [
  "provider_payout_id",
  "amount_minor",
  "currency",
  "status",
  "settled_at"
] as const;
const maxCsvBytes = 1_000_000;
const maxRows = 1_000;

@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(ReconciliationRepository) private readonly repository: ReconciliationRepository
  ) {}

  listImports(tenantId: string): Promise<ReconciliationImportSummary[]> {
    return this.repository.listImports(requiredString(tenantId, "tenantId"));
  }

  getImport(tenantId: string, importId: string): Promise<ReconciliationImportDetails> {
    return this.repository.getImport(
      requiredString(tenantId, "tenantId"),
      requiredString(importId, "importId")
    );
  }

  async createImport(
    tenantId: string,
    body: CreateReconciliationImportRequest,
    principal?: AuthenticatedPrincipal
  ): Promise<ReconciliationImportDetails> {
    const csv = requiredString(body.csv, "csv");

    if (Buffer.byteLength(csv, "utf8") > maxCsvBytes) {
      throw new BadRequestException("csv must be no larger than 1 MB");
    }

    const rows = parseSettlementCsv(csv);
    const actor = reconciliationActor(principal);

    const reconciliation = await this.repository.createImport({
      tenantExternalId: requiredString(tenantId, "tenantId"),
      externalId: externalId("rec"),
      providerName: limitedString(body.providerName, "providerName", 128),
      fileName: limitedString(body.fileName, "fileName", 256),
      fileSha256: createHash("sha256").update(csv).digest("hex"),
      actorType: actor.type,
      actorId: actor.id,
      rows
    });

    recordPaymentOperation("reconciliation.completed", {
      "paymentops.reconciliation.rows": reconciliation.rowCount,
      "paymentops.reconciliation.discrepancies": reconciliation.discrepancyCount
    });
    return reconciliation;
  }
}

export function parseSettlementCsv(csv: string): SettlementImportRowInput[] {
  let records: Record<string, string>[];

  try {
    records = parse(csv, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 4096
    }) as Record<string, string>[];
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid CSV";
    throw new BadRequestException("Unable to parse settlement CSV: " + message);
  }

  if (records.length === 0) {
    throw new BadRequestException("Settlement CSV must contain at least one data row");
  }

  if (records.length > maxRows) {
    throw new BadRequestException("Settlement CSV cannot contain more than 1000 rows");
  }

  const columns = new Set(Object.keys(records[0] ?? {}));
  const missingColumns = requiredColumns.filter((column) => !columns.has(column));

  if (missingColumns.length > 0) {
    throw new BadRequestException(
      "Settlement CSV is missing columns: " + missingColumns.join(", ")
    );
  }

  const seenProviderPayoutIds = new Set<string>();

  return records.map((record, index) => {
    const rowNumber = index + 2;
    const providerPayoutId = rowString(record.provider_payout_id, "provider_payout_id", rowNumber);
    const amountMinor = Number(rowString(record.amount_minor, "amount_minor", rowNumber));
    const currency = rowString(record.currency, "currency", rowNumber).toUpperCase();
    const providerStatus = rowString(record.status, "status", rowNumber).toLowerCase();
    const settledAtValue = record.settled_at?.trim() ?? "";

    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException(
        "amount_minor on row " + rowNumber + " must be a positive integer"
      );
    }

    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException(
        "currency on row " + rowNumber + " must be a three-letter code"
      );
    }

    if (seenProviderPayoutIds.has(providerPayoutId)) {
      throw new BadRequestException(
        "provider_payout_id " + providerPayoutId + " appears more than once"
      );
    }
    seenProviderPayoutIds.add(providerPayoutId);

    let settledAt: Date | null = null;
    if (settledAtValue) {
      settledAt = new Date(settledAtValue);
      if (Number.isNaN(settledAt.getTime())) {
        throw new BadRequestException("settled_at on row " + rowNumber + " is invalid");
      }
    }

    return {
      providerPayoutId,
      amountMinor,
      currency,
      providerStatus,
      settledAt
    };
  });
}

function rowString(value: unknown, field: string, rowNumber: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required on row " + rowNumber);
  }

  return value.trim();
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(field + " is required");
  }

  return value.trim();
}

function limitedString(value: unknown, field: string, maxLength: number): string {
  const normalized = requiredString(value, field);

  if (normalized.length > maxLength) {
    throw new BadRequestException(field + " cannot exceed " + maxLength + " characters");
  }

  return normalized;
}

function reconciliationActor(principal?: AuthenticatedPrincipal): {
  type: AuthPrincipalType;
  id: string;
} {
  return {
    type: principal?.type ?? "dev_admin",
    id: principal?.email ?? principal?.subject ?? "paymentops-api"
  };
}

function externalId(prefix: string): string {
  return prefix + "_" + randomBytes(8).toString("hex");
}
