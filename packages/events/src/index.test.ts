import { describe, expect, it } from "vitest";

import {
  createWebhookSignature,
  createWebhookSignatureHeaders,
  paymentOpsTopics,
  paymentOpsWebhookHeaders,
  verifyWebhookSignature
} from "./index.js";

describe("paymentOpsTopics", () => {
  it("keeps payout created topic versioned", () => {
    expect(paymentOpsTopics.payoutCreated).toBe("paymentops.payout.created.v1");
  });
});

describe("webhook signatures", () => {
  it("signs and verifies merchant webhook payloads", () => {
    const payload = JSON.stringify({ id: "evt_test", type: "payout.paid.v1" });
    const signature = createWebhookSignature({
      secret: "whsec_test",
      timestamp: "2026-06-24T00:00:00.000Z",
      eventId: "evt_test",
      payload
    });

    expect(signature).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(
      verifyWebhookSignature({
        secret: "whsec_test",
        timestamp: "2026-06-24T00:00:00.000Z",
        eventId: "evt_test",
        payload,
        signature
      })
    ).toBe(true);
  });

  it("creates the expected outbound header names", () => {
    const headers = createWebhookSignatureHeaders({
      secret: "whsec_test",
      timestamp: "2026-06-24T00:00:00.000Z",
      eventId: "evt_test",
      deliveryId: "whd_test",
      payload: "{}"
    });

    expect(headers[paymentOpsWebhookHeaders.eventId]).toBe("evt_test");
    expect(headers[paymentOpsWebhookHeaders.deliveryId]).toBe("whd_test");
  });
});
