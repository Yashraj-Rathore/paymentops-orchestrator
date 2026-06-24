import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedPrincipal } from "../auth/auth.types.js";
import { ApprovalsRepository } from "./approvals.repository.js";
import { ApprovalsService } from "./approvals.service.js";

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

describe("ApprovalsService", () => {
  const repository = {
    listApprovals: vi.fn(),
    decideApproval: vi.fn()
  } as unknown as ApprovalsRepository;

  let service: ApprovalsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ApprovalsService(repository);
  });

  it("approves payouts with the authenticated actor", async () => {
    vi.mocked(repository.decideApproval).mockResolvedValue({
      id: "apr_1",
      payoutId: "po_1",
      tenantId: "mer_test",
      status: "approved",
      riskRuleId: "risk_1",
      riskReason: "Amount requires review",
      amountMinor: 125000,
      currency: "USD",
      destinationAccount: "acct_1",
      requestedAt: "2026-06-24T00:00:00.000Z",
      decidedAt: "2026-06-24T00:00:01.000Z",
      decidedBy: "ops@example.com",
      payout: {
        id: "po_1",
        tenantId: "mer_test",
        providerPayoutId: null,
        amountMinor: 125000,
        currency: "USD",
        destinationAccount: "acct_1",
        reference: null,
        description: null,
        status: "queued",
        createdAt: "2026-06-24T00:00:00.000Z",
        updatedAt: "2026-06-24T00:00:01.000Z"
      }
    });

    await service.approvePayout("mer_test", "po_1", { reason: " good " }, principal);

    expect(repository.decideApproval).toHaveBeenCalledWith({
      tenantExternalId: "mer_test",
      payoutExternalId: "po_1",
      decision: "approved",
      decisionReason: "good",
      actorType: "dev_admin",
      actorId: "ops@example.com"
    });
  });

  it("rejects payouts and normalizes blank reasons", async () => {
    vi.mocked(repository.decideApproval).mockResolvedValue({
      id: "apr_1",
      payoutId: "po_1",
      tenantId: "mer_test",
      status: "rejected",
      riskRuleId: "risk_1",
      riskReason: "Amount requires review",
      amountMinor: 125000,
      currency: "USD",
      destinationAccount: "acct_1",
      requestedAt: "2026-06-24T00:00:00.000Z",
      decidedAt: "2026-06-24T00:00:01.000Z",
      decidedBy: "paymentops-api",
      payout: {
        id: "po_1",
        tenantId: "mer_test",
        providerPayoutId: null,
        amountMinor: 125000,
        currency: "USD",
        destinationAccount: "acct_1",
        reference: null,
        description: null,
        status: "canceled",
        createdAt: "2026-06-24T00:00:00.000Z",
        updatedAt: "2026-06-24T00:00:01.000Z"
      }
    });

    await service.rejectPayout("mer_test", "po_1", { reason: "   " });

    expect(repository.decideApproval).toHaveBeenCalledWith({
      tenantExternalId: "mer_test",
      payoutExternalId: "po_1",
      decision: "rejected",
      decisionReason: null,
      actorType: "dev_admin",
      actorId: "paymentops-api"
    });
  });
});
