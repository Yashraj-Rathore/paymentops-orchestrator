import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { loadConfig } from "@paymentops/config";
import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";

import {
  asyncJobNames,
  asyncQueueNames,
  asyncRetryPolicy,
  type DeadLetterJobData,
  type PayoutDispatchJobData,
  type WebhookDeliveryJobData
} from "./async.constants.js";

const retryingJobOptions: JobsOptions = {
  attempts: asyncRetryPolicy.attempts,
  backoff: {
    type: "exponential",
    delay: asyncRetryPolicy.backoffMs
  },
  removeOnComplete: {
    age: 24 * 60 * 60,
    count: 10_000
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60,
    count: 10_000
  }
};

@Injectable()
export class AsyncQueueService implements OnApplicationShutdown {
  private readonly config = loadConfig("worker");
  private readonly queueConnection = createRedisConnectionOptions(this.config.redisUrl, false);
  readonly payoutDispatch = new Queue<PayoutDispatchJobData>(asyncQueueNames.payoutDispatch, {
    connection: this.queueConnection
  });
  readonly webhookDelivery = new Queue<WebhookDeliveryJobData>(asyncQueueNames.webhookDelivery, {
    connection: this.queueConnection
  });
  readonly deadLetter = new Queue<DeadLetterJobData>(asyncQueueNames.deadLetter, {
    connection: this.queueConnection
  });

  workerConnection(): ConnectionOptions {
    return createRedisConnectionOptions(this.config.redisUrl, true);
  }

  async enqueuePayoutDispatch(outboxEventId: string): Promise<void> {
    await this.payoutDispatch.add(
      asyncJobNames.payoutDispatch,
      { outboxEventId },
      {
        ...retryingJobOptions,
        jobId: `payout-${safeJobId(outboxEventId)}`
      }
    );
  }

  async enqueueWebhookDelivery(deliveryExternalId: string, jobId: string): Promise<void> {
    await this.webhookDelivery.add(
      asyncJobNames.webhookDelivery,
      { deliveryExternalId },
      {
        ...retryingJobOptions,
        jobId: safeJobId(jobId)
      }
    );
  }

  async enqueueDeadLetter(input: Omit<DeadLetterJobData, "failedAt">): Promise<void> {
    await this.deadLetter.add(
      asyncJobNames.deadLetter,
      {
        ...input,
        failedAt: new Date().toISOString()
      },
      {
        jobId: safeJobId(`dlq-${input.sourceQueue}-${input.sourceJobId}`)
      }
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([
      this.payoutDispatch.close(),
      this.webhookDelivery.close(),
      this.deadLetter.close()
    ]);
  }
}

export function createRedisConnectionOptions(
  redisUrl: string,
  workerConnection: boolean
): ConnectionOptions {
  const parsed = new URL(redisUrl);

  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }

  const database = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;

  if (!Number.isInteger(database) || database < 0) {
    throw new Error("REDIS_URL database must be a non-negative integer");
  }

  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: database,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    enableReadyCheck: false,
    maxRetriesPerRequest: workerConnection ? null : 1
  };
}

function safeJobId(value: string): string {
  return value.replaceAll(":", "-");
}
