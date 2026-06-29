import { describe, expect, it, vi } from "vitest";

import type { AsyncQueueService } from "./async-queue.service.js";
import { OutboxRelayService } from "./outbox-relay.service.js";
import type { OutboxRepository } from "./outbox.repository.js";
import type { RedpandaPublisherService } from "./redpanda-publisher.service.js";

const payoutEvent = {
  id: "event-uuid",
  tenantId: "tenant-uuid",
  eventType: "payout.created.v1",
  aggregateType: "payout",
  aggregateId: "po_test",
  payloadJson: JSON.stringify({ payoutId: "po_test" }),
  attempts: 0,
  createdAt: new Date("2026-06-28T00:00:00.000Z")
};

describe("OutboxRelayService", () => {
  it("publishes and enqueues payout events before marking them complete", async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([payoutEvent]),
      markPublished: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined)
    } as unknown as OutboxRepository;
    const publisher = {
      publish: vi.fn().mockResolvedValue(undefined)
    } as unknown as RedpandaPublisherService;
    const queues = {
      enqueuePayoutDispatch: vi.fn().mockResolvedValue(undefined),
      enqueueDeadLetter: vi.fn().mockResolvedValue(undefined)
    } as unknown as AsyncQueueService;

    await new OutboxRelayService(repository, publisher, queues).processOnce();

    expect(publisher.publish).toHaveBeenCalledWith(payoutEvent);
    expect(queues.enqueuePayoutDispatch).toHaveBeenCalledWith(payoutEvent.id);
    expect(repository.markPublished).toHaveBeenCalledWith(
      payoutEvent.id,
      expect.any(String)
    );
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("records a retry when broker publication fails", async () => {
    const repository = {
      claimBatch: vi.fn().mockResolvedValue([payoutEvent]),
      markPublished: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined)
    } as unknown as OutboxRepository;
    const publisher = {
      publish: vi.fn().mockRejectedValue(new Error("broker unavailable"))
    } as unknown as RedpandaPublisherService;
    const queues = {
      enqueuePayoutDispatch: vi.fn().mockResolvedValue(undefined),
      enqueueDeadLetter: vi.fn().mockResolvedValue(undefined)
    } as unknown as AsyncQueueService;

    await new OutboxRelayService(repository, publisher, queues).processOnce();

    expect(repository.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: payoutEvent.id,
        deadLetter: false,
        error: "broker unavailable"
      })
    );
    expect(repository.markPublished).not.toHaveBeenCalled();
  });
});