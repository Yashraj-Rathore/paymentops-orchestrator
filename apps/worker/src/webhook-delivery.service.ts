import { Inject, Injectable } from "@nestjs/common";
import type { MerchantWebhookEnvelope } from "@paymentops/contracts";
import { createWebhookSignatureHeaders } from "@paymentops/events";
import { createLogger } from "@paymentops/logger";
import { recordPaymentOperation, withActiveSpan } from "@paymentops/observability";

import {
  WebhookDeliveryRepository,
  type PendingWebhookDelivery
} from "./webhook-delivery.repository.js";

const webhookTimeoutMs = 5000;

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = createLogger({
    service: "worker",
    environment: process.env.NODE_ENV ?? "development"
  });

  constructor(
    @Inject(WebhookDeliveryRepository) private readonly repository: WebhookDeliveryRepository
  ) {}

  async processJob(
    deliveryExternalId: string,
    attemptNumber: number,
    maxAttempts: number
  ): Promise<void> {
    const delivery = await this.repository.findDeliveryByExternalId(deliveryExternalId);

    if (!delivery || !["pending", "failed"].includes(delivery.status)) {
      return;
    }

    await withActiveSpan(
      "paymentops.webhook.deliver",
      {
        "paymentops.webhook.delivery_id": delivery.deliveryExternalId,
        "paymentops.job.attempt": attemptNumber
      },
      () => this.sendDelivery(delivery, attemptNumber, maxAttempts)
    );
  }

  private async sendDelivery(
    delivery: PendingWebhookDelivery,
    attemptNumber: number,
    maxAttempts: number
  ): Promise<void> {
    const startedAt = Date.now();
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

      if (!response.ok) {
        throw new WebhookHttpError(response.status, responseBody);
      }

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
        statusCode: response.status,
        attempt: attemptNumber
      });
      recordPaymentOperation("webhook.delivered");
    } catch (error) {
      const deadLetter = attemptNumber >= maxAttempts;
      const statusCode = error instanceof WebhookHttpError ? error.statusCode : null;
      const responseBody = error instanceof WebhookHttpError ? error.responseBody : null;
      const message =
        error instanceof Error ? error.message : "Webhook delivery failed without an error message";

      await this.repository.recordDeliveryFailed({
        deliveryId: delivery.deliveryId,
        deliveryExternalId: delivery.deliveryExternalId,
        tenantId: delivery.tenantId,
        eventType: delivery.eventType,
        attemptNumber,
        statusCode,
        responseBody,
        errorMessage: truncate(message, 1000),
        durationMs: Date.now() - startedAt,
        nextAttemptAt: deadLetter ? null : new Date(Date.now() + retryBackoffMs(attemptNumber)),
        deadLetter
      });

      this.logger.warn("webhook delivery failed", {
        resourceType: "webhook_delivery",
        resourceId: delivery.deliveryExternalId,
        eventType: delivery.eventType,
        attempt: attemptNumber,
        deadLetter,
        error: message
      });
      recordPaymentOperation(deadLetter ? "webhook.dead_lettered" : "webhook.failed");
      throw error;
    }
  }
}

class WebhookHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly responseBody: string
  ) {
    super(`Merchant endpoint returned HTTP ${statusCode}`);
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
