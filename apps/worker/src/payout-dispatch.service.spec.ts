import { afterEach, describe, expect, it, vi } from "vitest";

import type { PayoutDispatchRepository } from "./payout-dispatch.repository.js";
import { PayoutDispatchService } from "./payout-dispatch.service.js";

function createRepository(overrides: Partial<PayoutDispatchRepository> = {}) {
  return {
    findDispatchByOutboxEventId: vi.fn().mockResolvedValue({
      outboxEventId: "event-id",
      tenantId: "tenant-uuid",
      tenantExternalId: "mer_test",
      payoutId: "payout-uuid",
      payoutExternalId: "po_test",
      providerPayoutId: null,
      status: "queued",
      amountMinor: 2500,
      currency: "USD",
      destinationAccount: "acct_test"
    }),
    markDispatchSucceeded: vi.fn().mockResolvedValue(undefined),
    recordDispatchFailure: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as PayoutDispatchRepository;
}

describe("PayoutDispatchService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches queued payout jobs to the provider simulator", async () => {
    const repository = createRepository();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          providerPayoutId: "pp_test",
          status: "processing",
          callbackDelayMs: 1500
        })
      })
    );

    await new PayoutDispatchService(repository).processJob("event-id", 1, 5);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "idempotency-key": "po_test" })
      })
    );
    expect(repository.markDispatchSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        payoutExternalId: "po_test",
        providerPayoutId: "pp_test"
      })
    );
    expect(repository.recordDispatchFailure).not.toHaveBeenCalled();
  });

  it("records a terminal payout failure on the final queue attempt", async () => {
    const repository = createRepository();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503
      })
    );

    await expect(
      new PayoutDispatchService(repository).processJob("event-id", 5, 5)
    ).rejects.toThrow("HTTP 503");

    expect(repository.recordDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        payoutExternalId: "po_test",
        attemptNumber: 5,
        deadLetter: true
      })
    );
  });
});