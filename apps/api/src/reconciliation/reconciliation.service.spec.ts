import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedPrincipal } from "../auth/auth.types.js";
import { classifySettlementRow, ReconciliationRepository } from "./reconciliation.repository.js";
import { parseSettlementCsv, ReconciliationService } from "./reconciliation.service.js";

const principal: AuthenticatedPrincipal = {
  type: "dev_admin",
  subject: "dev-admin",
  email: "ops@example.com",
  roles: ["operations_admin"],
  permissions: [],
  tenantId: null,
  apiClientId: null,
  apiKeyId: null
};

const validCsv = [
  "provider_payout_id,amount_minor,currency,status,settled_at",
  "prov_1,125000,usd,paid,2026-06-27T12:00:00.000Z",
  "prov_2,4500,USD,failed,"
].join("\n");

describe("parseSettlementCsv", () => {
  it("parses and normalizes provider rows", () => {
    expect(parseSettlementCsv(validCsv)).toEqual([
      {
        providerPayoutId: "prov_1",
        amountMinor: 125000,
        currency: "USD",
        providerStatus: "paid",
        settledAt: new Date("2026-06-27T12:00:00.000Z")
      },
      {
        providerPayoutId: "prov_2",
        amountMinor: 4500,
        currency: "USD",
        providerStatus: "failed",
        settledAt: null
      }
    ]);
  });

  it("rejects duplicate provider payout identifiers", () => {
    const duplicateCsv = validCsv + "\nprov_1,5000,USD,paid,";

    expect(() => parseSettlementCsv(duplicateCsv)).toThrow(BadRequestException);
  });

  it("rejects missing required headers", () => {
    expect(() => parseSettlementCsv("provider_payout_id,amount_minor\nprov_1,100")).toThrow(
      "Settlement CSV is missing columns"
    );
  });
});

describe("classifySettlementRow", () => {
  const settlementRow = {
    providerPayoutId: "prov_1",
    amountMinor: 125000,
    currency: "USD",
    providerStatus: "paid",
    settledAt: null
  };

  it("classifies matched, missing, and amount mismatch rows", () => {
    expect(
      classifySettlementRow(
        {
          id: "payout-id",
          external_id: "po_1",
          amount_minor: 125000,
          currency: "USD"
        },
        settlementRow
      )
    ).toBe("matched");
    expect(classifySettlementRow(undefined, settlementRow)).toBe("missing");
    expect(
      classifySettlementRow(
        {
          id: "payout-id",
          external_id: "po_1",
          amount_minor: 125100,
          currency: "USD"
        },
        settlementRow
      )
    ).toBe("amount_mismatch");
  });
});

describe("ReconciliationService", () => {
  const repository = {
    createImport: vi.fn(),
    listImports: vi.fn(),
    getImport: vi.fn(),
    resolveDiscrepancy: vi.fn(),
    getSettlementReportRows: vi.fn()
  } as unknown as ReconciliationRepository;
  let service: ReconciliationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ReconciliationService(repository);
  });

  it("resolves discrepancies with validated actor context", async () => {
    vi.mocked(repository.resolveDiscrepancy).mockResolvedValue({
      id: "rcd_1",
      settlementRowId: "row_1",
      providerPayoutId: "prov_1",
      payoutId: "po_1",
      type: "amount_mismatch",
      status: "resolved",
      expectedAmountMinor: 125000,
      actualAmountMinor: 125100,
      expectedCurrency: "USD",
      actualCurrency: "USD",
      resolutionNote: "Provider correction accepted",
      resolvedBy: "ops@example.com",
      createdAt: "2026-06-27T12:00:00.000Z",
      resolvedAt: "2026-06-27T12:10:00.000Z"
    });

    await service.resolveDiscrepancy(
      "mer_test",
      "rcd_1",
      { resolutionNote: " Provider correction accepted " },
      principal
    );

    expect(repository.resolveDiscrepancy).toHaveBeenCalledWith({
      tenantExternalId: "mer_test",
      discrepancyExternalId: "rcd_1",
      resolutionNote: "Provider correction accepted",
      actorType: "dev_admin",
      actorId: "ops@example.com"
    });
  });

  it("exports a standards-compliant settlement CSV", async () => {
    vi.mocked(repository.getSettlementReportRows).mockResolvedValue([
      {
        importId: "rec_1",
        providerName: 'Demo, "Payments"',
        fileName: "settlement.csv",
        providerPayoutId: "prov_1",
        payoutId: "po_1",
        amountMinor: 125000,
        currency: "USD",
        providerStatus: "paid",
        settledAt: "2026-06-27T12:00:00.000Z",
        matchStatus: "amount_mismatch",
        discrepancyType: "amount_mismatch",
        discrepancyStatus: "resolved",
        resolutionNote: "Accepted, after review",
        resolvedBy: "ops@example.com",
        resolvedAt: "2026-06-27T12:10:00.000Z"
      }
    ]);

    const csv = await service.exportSettlementReport("mer_test");

    expect(csv).toContain('"Demo, ""Payments"""');
    expect(csv).toContain('"Accepted, after review"');
    expect(repository.getSettlementReportRows).toHaveBeenCalledWith("mer_test");
  });

  it("hashes and forwards a validated import with actor context", async () => {
    vi.mocked(repository.createImport).mockResolvedValue({
      id: "rec_1",
      tenantId: "mer_test",
      providerName: "DemoPay",
      fileName: "settlement.csv",
      status: "completed",
      rowCount: 2,
      matchedCount: 1,
      discrepancyCount: 1,
      importedBy: "ops@example.com",
      createdAt: "2026-06-27T12:00:00.000Z",
      completedAt: "2026-06-27T12:00:01.000Z",
      rows: [],
      discrepancies: []
    });

    await service.createImport(
      "mer_test",
      {
        providerName: " DemoPay ",
        fileName: " settlement.csv ",
        csv: validCsv
      },
      principal
    );

    expect(repository.createImport).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantExternalId: "mer_test",
        providerName: "DemoPay",
        fileName: "settlement.csv",
        actorType: "dev_admin",
        actorId: "ops@example.com",
        rows: expect.arrayContaining([
          expect.objectContaining({ providerPayoutId: "prov_1", currency: "USD" })
        ])
      })
    );
  });
});
