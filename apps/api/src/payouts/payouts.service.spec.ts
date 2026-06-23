import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedPrincipal } from "../auth/auth.types.js";
import { PayoutsRepository } from "./payouts.repository.js";
import { PayoutsService } from "./payouts.service.js";

const principal: AuthenticatedPrincipal = {
  type: "api_key",
  subject: "cli_test",
  email: null,
  roles: [],
  permissions: ["payouts:create", "payouts:read"],
  tenantId: "mer_test",
  apiClientId: "cli_test",
  apiKeyId: "key_test"
};

describe("PayoutsService", () => {
  const repository = {
    createPayout: vi.fn(),
    listPayouts: vi.fn(),
    getPayout: vi.fn()
  } as unknown as PayoutsRepository;

  let service: PayoutsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PayoutsService(repository);
  });

  it("requires an idempotency key when creating payouts", async () => {
    await expect(
      service.createPayout(
        "mer_test",
        undefined,
        {
          amountMinor: 1000,
          currency: "usd",
          destinationAccount: "acct_123"
        },
        principal
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("normalizes payout input before persistence", async () => {
    vi.mocked(repository.createPayout).mockResolvedValue({
      id: "po_test",
      tenantId: "mer_test",
      providerPayoutId: null,
      amountMinor: 2500,
      currency: "USD",
      destinationAccount: "acct_123",
      reference: "invoice-1",
      description: null,
      status: "queued",
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      ledgerEntries: [],
      statusHistory: [],
      outboxEvents: [],
      idempotencyKey: "idem_1",
      replayed: false
    });

    await service.createPayout(
      "mer_test",
      " idem_1 ",
      {
        amountMinor: 2500,
        currency: "usd",
        destinationAccount: " acct_123 ",
        reference: " invoice-1 ",
        description: ""
      },
      principal
    );

    expect(repository.createPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantExternalId: "mer_test",
        idempotencyKey: "idem_1",
        amountMinor: 2500,
        currency: "USD",
        destinationAccount: "acct_123",
        reference: "invoice-1",
        description: null,
        apiClientExternalId: "cli_test",
        apiKeyExternalId: "key_test"
      })
    );
  });

  it("blocks API keys from accessing another tenant", async () => {
    await expect(
      service.listPayouts("mer_other", principal)
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
