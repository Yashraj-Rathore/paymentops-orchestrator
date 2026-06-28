import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import type { MerchantWebhookEnvelope } from "@paymentops/contracts";
import { createWebhookSignatureHeaders } from "@paymentops/events";
import { createLogger } from "@paymentops/logger";
import { recordPaymentOperation, withActiveSpan } from "@paymentops/observability";

import {
  WebhookDeliveryRepository,
  type PendingWebhookDelivery
} from "./webhook-delivery.repository.js";

const pollIntervalMs = 3000;
const maxDeliveryAttempts = 5;
const webhookTimeoutMs = 5000;

@Injectable()
export class WebhookDeliveryService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = createLogger({
    service: "worker",
    environment: process.env.NODE_ENV ?? "development"
  });
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(WebhookDeliveryRepository) private readonly repository: WebhookDeliveryRepository
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.processOnce();
    }, pollIntervalMs);

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
      await this.repository.scheduleMissingDeliveries();
      const deliveries = await this.repository.findSendableDeliveries();

      for (const delivery of deliveries) {
        await withActiveSpan(
          "paymentops.webhook.deliver",
          { "paymentops.webhook.delivery_id": delivery.deliveryExternalId },
          () => this.sendDelivery(delivery)
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async sendDelivery(delivery: PendingWebhookDelivery): Promise<void> {
    const startedAt = Date.now();
    const attemptNumber = delivery.attempts + 1;
    const payload = buildWebhookPayload(delivery);
    const timestamp = new Date().toISOString();
    const headers = createWebhookSignatureHeaders({
      secret: delivery.signingSecret,
      timestamp,
      eventId: delivery.outboxEventId,
      deliveryId: delivery.deliveryExternalId,
      payload
    });

    try {
      const response = await fetch(delivery.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "PaymentOps-Orchestrator/0.1",
          ...headers
        },
        body: payload,
        signal: AbortSignal.timeout(webhookTimeoutMs)
      });
      const responseBody = truncate(await response.text(), 2000);
      const durationMs = Date.now() - startedAt;

      if (response.ok) {
        await this.repository.recordDeliverySucceeded({
          deliveryId: delivery.deliveryId,
          attemptNumber,
          statusCode: response.status,
          responseBody,
          durationMs
        });
        this.logger.info("webhook delivered", {
          resourceType: "webhook_delivery",
          resourceId: delivery.deliveryExternalId,
          eventType: delivery.eventType,
          statusCode: response.status
        });
        recordPaymentOperation("webhook.delivered");
        return;
      }

      await this.recordFailure(delivery, {
        attemptNumber,
        statusCode: response.status,
        responseBody,
        errorMessage: `Merchant endpoint returned HTTP ${response.status}`,
        durationMs
      });
    } catch (error) {
      await this.recordFailure(delivery, {
        attemptNumber,
        statusCode: null,
        responseBody: null,
        errorMessage: error instanceof Error ? error.message : "Webhook delivery failed",
        durationMs: Date.now() - startedAt
      });
    }
  }

  private async recordFailure(
    delivery: PendingWebhookDelivery,
    failure: {
      attemptNumber: number;
      statusCode: number | null;
      responseBody: string | null;
      errorMessage: string;
      durationMs: number;
    }
  ): Promise<void> {
    const deadLetter = failure.attemptNumber >= maxDeliveryAttempts;
    const nextAttemptAt = deadLetter
      ? null
      : new Date(Date.now() + retryBackoffMs(failure.attemptNumber));

    await this.repository.recordDeliveryFailed({
      deliveryId: delivery.deliveryId,
      deliveryExternalId: delivery.deliveryExternalId,
      tenantId: delivery.tenantId,
      eventType: delivery.eventType,
      attemptNumber: failure.attemptNumber,
      statusCode: failure.statusCode,
      responseBody: failure.responseBody,
      errorMessage: truncate(failure.errorMessage, 1000),
      durationMs: failure.durationMs,
      nextAttemptAt,
      deadLetter
    });

    this.logger.warn("webhook delivery failed", {
      resourceType: "webhook_delivery",
      resourceId: delivery.deliveryExternalId,
      eventType: delivery.eventType,
      attempt: failure.attemptNumber,
      deadLetter,
      error: failure.errorMessage
    });
    recordPaymentOperation(deadLetter ? "webhook.dead_lettered" : "webhook.failed");
  }
}

function buildWebhookPayload(delivery: PendingWebhookDelivery): string {
  const envelope: MerchantWebhookEnvelope = {
    id: delivery.outboxEventId,
    type: delivery.eventType,
    tenantId: delivery.tenantId,
    aggregateType: delivery.aggregateType,
    aggregateId: delivery.aggregateId,
    createdAt: delivery.createdAt.toISOString(),
    payload: parsePayload(delivery.payloadJson)
  };

  return JSON.stringify(envelope);
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  const payload = JSON.parse(payloadJson) as unknown;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function retryBackoffMs(attemptNumber: number): number {
  return Math.min(60_000, 2 ** attemptNumber * 1000);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
