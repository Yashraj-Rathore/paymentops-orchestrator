import { describe, expect, it } from "vitest";

import { paymentOpsTopics } from "./index.js";

describe("paymentOpsTopics", () => {
  it("keeps payout created topic versioned", () => {
    expect(paymentOpsTopics.payoutCreated).toBe("paymentops.payout.created.v1");
  });
});