import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderPayoutsService } from "./provider-payouts.service.js";

describe("ProviderPayoutsService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("accepts a payout and schedules a callback", () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());

    const response = new ProviderPayoutsService().createPayout({
      payoutId: "po_test",
      tenantId: "mer_test",
      amountMinor: 2500,
      currency: "usd",
      destinationAccount: "acct_test",
      callbackUrl: "http://localhost:3000/v1/provider-callbacks/payouts"
    });

    expect(response.providerPayoutId).toMatch(/^pp_/);
    expect(response.status).toBe("processing");
    expect(response.callbackDelayMs).toBeGreaterThan(0);
  });
});
