import { afterEach, describe, expect, it, vi } from "vitest";

import type { PayoutDispatchRepository } from "./payout-dispatch.repository.js";
import { PayoutDispatchService } from "./payout-dispatch.service.js";

describe("PayoutDispatchService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches queued payout events to the provider simulator", async () => {
    const repository = {
      findPendingPayoutDispatches: vi.fn().mockResolvedValue([
        {
          outboxEventId: "event-id",
          attempts: 0,
          tenantId: "tenant-uuid",
          tenantExternalId: "mer_test",
          payoutId: "payout-uuid",
          payoutExternalId: "po_test",
          providerPayoutId: null,
          status: "queued",
          amountMinor: 2500,
          currency: "USD",
          destinationAccount: "acct_test"
        }
      ]),
      markDispatchSucceeded: vi.fn().mockResolvedValue(undefined),
      markDispatchFailed: vi.fn().mockResolvedValue(undefined)
    } as unknown as PayoutDispatchRepository;

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

    await new PayoutDispatchService(repository).processOnce();

    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: "POST" })
    );
    expect(repository.markDispatchSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxEventId: "event-id",
        payoutExternalId: "po_test",
        providerPayoutId: "pp_test"
      })
    );
    expect(repository.markDispatchFailed).not.toHaveBeenCalled();
  });
});
