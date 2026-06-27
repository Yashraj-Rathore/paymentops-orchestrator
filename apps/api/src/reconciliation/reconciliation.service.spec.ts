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
    getImport: vi.fn()
  } as unknown as ReconciliationRepository;
  let service: ReconciliationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ReconciliationService(repository);
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
