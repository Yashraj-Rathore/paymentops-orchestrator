import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebhookDeliveryRepository } from "./webhook-delivery.repository.js";
import { WebhookDeliveryService } from "./webhook-delivery.service.js";

function createRepository(overrides: Partial<WebhookDeliveryRepository> = {}) {
  return {
    scheduleMissingDeliveries: vi.fn().mockResolvedValue(1),
    findSendableDeliveries: vi.fn().mockResolvedValue([
      {
        deliveryId: "delivery-uuid",
        deliveryExternalId: "whd_test",
        webhookEndpointExternalId: "whk_test",
        outboxEventId: "evt-uuid",
        tenantId: "tenant-uuid",
        tenantExternalId: "mer_test",
        eventType: "payout.paid.v1",
        aggregateType: "payout",
        aggregateId: "po_test",
        payloadJson: JSON.stringify({ payoutId: "po_test", status: "paid" }),
        status: "pending",
        attempts: 0,
        url: "https://merchant.example/webhooks",
        signingSecret: "whsec_test",
        createdAt: new Date("2026-06-24T00:00:00.000Z")
      }
    ]),
    recordDeliverySucceeded: vi.fn().mockResolvedValue(undefined),
    recordDeliveryFailed: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as WebhookDeliveryRepository;
}

describe("WebhookDeliveryService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends signed merchant webhooks", async () => {
    const repository = createRepository();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: vi.fn().mockResolvedValue("")
      })
    );

    await new WebhookDeliveryService(repository).processOnce();

    expect(repository.scheduleMissingDeliveries).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "https://merchant.example/webhooks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "PaymentOps-Delivery-Id": "whd_test",
          "PaymentOps-Event-Id": "evt-uuid",
          "PaymentOps-Signature": expect.stringMatching(/^v1=[a-f0-9]{64}$/)
        })
      })
    );
    expect(repository.recordDeliverySucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "delivery-uuid",
        attemptNumber: 1,
        statusCode: 204
      })
    );
  });

  it("dead-letters after the maximum attempt", async () => {
    const repository = createRepository({
      findSendableDeliveries: vi.fn().mockResolvedValue([
        {
          deliveryId: "delivery-uuid",
          deliveryExternalId: "whd_test",
          webhookEndpointExternalId: "whk_test",
          outboxEventId: "evt-uuid",
          tenantId: "tenant-uuid",
          tenantExternalId: "mer_test",
          eventType: "payout.failed.v1",
          aggregateType: "payout",
          aggregateId: "po_test",
          payloadJson: JSON.stringify({ payoutId: "po_test", status: "failed" }),
          status: "failed",
          attempts: 4,
          url: "https://merchant.example/webhooks",
          signingSecret: "whsec_test",
          createdAt: new Date("2026-06-24T00:00:00.000Z")
        }
      ])
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("down")
      })
    );

    await new WebhookDeliveryService(repository).processOnce();

    expect(repository.recordDeliveryFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptNumber: 5,
        deadLetter: true,
        nextAttemptAt: null,
        statusCode: 500
      })
    );
  });
});
