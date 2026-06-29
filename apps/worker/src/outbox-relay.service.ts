import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { createLogger } from "@paymentops/logger";
import { recordPaymentOperation, withActiveSpan } from "@paymentops/observability";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { asyncQueueNames, asyncRetryPolicy } from "./async.constants.js";
import { AsyncQueueService } from "./async-queue.service.js";
import { OutboxRepository, type ClaimedOutboxEvent } from "./outbox.repository.js";
import { RedpandaPublisherService } from "./redpanda-publisher.service.js";

const relayIntervalMs = 1000;

@Injectable()
export class OutboxRelayService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = createLogger({
    service: "worker",
    environment: process.env.NODE_ENV ?? "development"
  });
  private readonly workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(OutboxRepository) private readonly repository: OutboxRepository,
    @Inject(RedpandaPublisherService) private readonly publisher: RedpandaPublisherService,
    @Inject(AsyncQueueService) private readonly queues: AsyncQueueService
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.processOnce(), relayIntervalMs);
    void this.processOnce();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processOnce(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const events = await this.repository.claimBatch(this.workerId);

      for (const event of events) {
        await withActiveSpan(
          "paymentops.outbox.publish",
          {
            "paymentops.event.id": event.id,
            "paymentops.event.type": event.eventType
          },
          () => this.publish(event)
        );
      }
    } catch (error) {
      this.logger.warn("outbox relay cycle failed", {
        error: errorMessage(error)
      });
    } finally {
      this.running = false;
    }
  }

  private async publish(event: ClaimedOutboxEvent): Promise<void> {
    try {
      await this.publisher.publish(event);

      if (event.eventType === "payout.created.v1") {
        await this.queues.enqueuePayoutDispatch(event.id);
      }

      await this.repository.markPublished(event.id, this.workerId);
      recordPaymentOperation("outbox.published");
      this.logger.info("outbox event published", {
        resourceType: event.aggregateType,
        resourceId: event.aggregateId,
        eventId: event.id,
        eventType: event.eventType
      });
    } catch (error) {
      const attemptNumber = event.attempts + 1;
      const deadLetter = attemptNumber >= asyncRetryPolicy.attempts;
      const message = errorMessage(error);

      await this.repository.markFailed({
        eventId: event.id,
        workerId: this.workerId,
        error: truncate(message, 1000),
        nextAttemptAt: deadLetter ? null : new Date(Date.now() + retryBackoffMs(attemptNumber)),
        deadLetter
      });

      if (deadLetter) {
        await this.enqueueDeadLetterSafely(event, message);
      }

      recordPaymentOperation(deadLetter ? "outbox.dead_lettered" : "outbox.failed");
      this.logger.warn("outbox event publication failed", {
        resourceType: event.aggregateType,
        resourceId: event.aggregateId,
        eventId: event.id,
        eventType: event.eventType,
        attempt: attemptNumber,
        deadLetter,
        error: message
      });
    }
  }

  private async enqueueDeadLetterSafely(event: ClaimedOutboxEvent, error: string): Promise<void> {
    try {
      await this.queues.enqueueDeadLetter({
        sourceQueue: "sql-outbox",
        sourceJobId: event.id,
        resourceId: event.aggregateId,
        error: truncate(error, 1000)
      });
    } catch (deadLetterError) {
      this.logger.error("failed to mirror outbox dead letter to Redis", {
        resourceType: event.aggregateType,
        resourceId: event.aggregateId,
        eventId: event.id,
        queue: asyncQueueNames.deadLetter,
        error: errorMessage(deadLetterError)
      });
    }
  }
}

function retryBackoffMs(attemptNumber: number): number {
  return Math.min(60_000, 2 ** attemptNumber * 1000);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown asynchronous processing error";
}
