import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { createLogger } from "@paymentops/logger";
import { Worker, type Job } from "bullmq";
import { randomUUID } from "node:crypto";

import {
  asyncQueueNames,
  asyncRetryPolicy,
  type PayoutDispatchJobData,
  type WebhookDeliveryJobData
} from "./async.constants.js";
import { AsyncQueueService } from "./async-queue.service.js";
import { PayoutDispatchService } from "./payout-dispatch.service.js";
import { WebhookDeliveryRepository } from "./webhook-delivery.repository.js";
import { WebhookDeliveryService } from "./webhook-delivery.service.js";

const webhookRecoveryIntervalMs = 1000;

@Injectable()
export class QueueWorkersService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = createLogger({
    service: "worker",
    environment: process.env.NODE_ENV ?? "development"
  });
  private readonly workers: Worker[] = [];
  private recoveryTimer: NodeJS.Timeout | null = null;
  private recoveryRunning = false;

  constructor(
    @Inject(AsyncQueueService) private readonly queues: AsyncQueueService,
    @Inject(PayoutDispatchService) private readonly payoutDispatch: PayoutDispatchService,
    @Inject(WebhookDeliveryService) private readonly webhookDelivery: WebhookDeliveryService,
    @Inject(WebhookDeliveryRepository)
    private readonly webhookRepository: WebhookDeliveryRepository
  ) {}

  onModuleInit(): void {
    const connection = this.queues.workerConnection();
    const payoutWorker = new Worker<PayoutDispatchJobData>(
      asyncQueueNames.payoutDispatch,
      (job) => this.processPayoutJob(job),
      { connection, concurrency: 5 }
    );
    const webhookWorker = new Worker<WebhookDeliveryJobData>(
      asyncQueueNames.webhookDelivery,
      (job) => this.processWebhookJob(job),
      { connection, concurrency: 10 }
    );

    this.registerWorkerLogging(payoutWorker, asyncQueueNames.payoutDispatch);
    this.registerWorkerLogging(webhookWorker, asyncQueueNames.webhookDelivery);
    this.workers.push(payoutWorker, webhookWorker);

    this.recoveryTimer = setInterval(
      () => void this.scheduleWebhookDeliveries(),
      webhookRecoveryIntervalMs
    );
    void this.scheduleWebhookDeliveries();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }

    await Promise.all(this.workers.map((worker) => worker.close()));
  }

  async scheduleWebhookDeliveries(): Promise<void> {
    if (this.recoveryRunning) {
      return;
    }

    this.recoveryRunning = true;

    try {
      await this.webhookRepository.scheduleMissingDeliveries();
      const deliveries = await this.webhookRepository.findUnqueuedDeliveries();

      for (const delivery of deliveries) {
        const jobId = `webhook-${randomUUID()}`;
        const reserved = await this.webhookRepository.reserveQueueJob(delivery.deliveryId, jobId);

        if (!reserved) {
          continue;
        }

        try {
          await this.queues.enqueueWebhookDelivery(delivery.deliveryExternalId, jobId);
        } catch (error) {
          await this.webhookRepository.releaseQueueJob(delivery.deliveryId, jobId);
          throw error;
        }
      }
    } catch (error) {
      this.logger.warn("webhook queue recovery cycle failed", {
        error: errorMessage(error)
      });
    } finally {
      this.recoveryRunning = false;
    }
  }

  private async processPayoutJob(job: Job<PayoutDispatchJobData>): Promise<void> {
    const attemptNumber = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? asyncRetryPolicy.attempts;

    try {
      await this.payoutDispatch.processJob(job.data.outboxEventId, attemptNumber, maxAttempts);
    } catch (error) {
      if (attemptNumber >= maxAttempts) {
        await this.queues.enqueueDeadLetter({
          sourceQueue: asyncQueueNames.payoutDispatch,
          sourceJobId: job.id ?? job.data.outboxEventId,
          resourceId: job.data.outboxEventId,
          error: errorMessage(error)
        });
      }

      throw error;
    }
  }

  private async processWebhookJob(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const attemptNumber = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? asyncRetryPolicy.attempts;

    try {
      await this.webhookDelivery.processJob(
        job.data.deliveryExternalId,
        attemptNumber,
        maxAttempts
      );
    } catch (error) {
      if (attemptNumber >= maxAttempts) {
        await this.queues.enqueueDeadLetter({
          sourceQueue: asyncQueueNames.webhookDelivery,
          sourceJobId: job.id ?? job.data.deliveryExternalId,
          resourceId: job.data.deliveryExternalId,
          error: errorMessage(error)
        });
      }

      throw error;
    }
  }

  private registerWorkerLogging(worker: Worker, queue: string): void {
    worker.on("error", (error) => {
      this.logger.error("BullMQ worker error", {
        queue,
        error: error.message
      });
    });
    worker.on("failed", (job, error) => {
      this.logger.warn("BullMQ job attempt failed", {
        queue,
        jobId: job?.id ?? "unknown",
        attemptsMade: job?.attemptsMade ?? 0,
        error: error.message
      });
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown queue processing error";
}
