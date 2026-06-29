import { describe, expect, it } from "vitest";

import { topicForEventType } from "./redpanda-publisher.service.js";

describe("topicForEventType", () => {
  it("maps domain event names to PaymentOps Redpanda topics", () => {
    expect(topicForEventType("payout.created.v1")).toBe("paymentops.payout.created.v1");
    expect(topicForEventType("paymentops.payout.paid.v1")).toBe("paymentops.payout.paid.v1");
  });
});