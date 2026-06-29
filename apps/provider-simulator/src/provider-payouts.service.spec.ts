import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderPayoutsService } from "./provider-payouts.service.js";

const payoutRequest = {
  payoutId: "po_test",
  tenantId: "mer_test",
  amountMinor: 2500,
  currency: "usd",
  destinationAccount: "acct_test",
  callbackUrl: "http://localhost:3000/v1/provider-callbacks/payouts"
};

describe("ProviderPayoutsService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("accepts a payout and schedules a callback", () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());

    const response = new ProviderPayoutsService().createPayout(payoutRequest);

    expect(response.providerPayoutId).toMatch(/^pp_/);
    expect(response.status).toBe("processing");
    expect(response.callbackDelayMs).toBeGreaterThan(0);
  });

  it("returns the original provider payout for duplicate submissions", () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
    const service = new ProviderPayoutsService();

    const first = service.createPayout(payoutRequest);
    const duplicate = service.createPayout(payoutRequest);

    expect(duplicate).toEqual(first);
    expect(vi.getTimerCount()).toBe(1);
  });
});