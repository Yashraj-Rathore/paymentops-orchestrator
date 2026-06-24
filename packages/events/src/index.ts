import type { EventEnvelope } from "@paymentops/contracts";
import { createHmac, timingSafeEqual } from "node:crypto";

export const paymentOpsTopics = {
  payoutCreated: "paymentops.payout.created.v1",
  payoutApprovalRequested: "paymentops.payout.approval_requested.v1",
  payoutApproved: "paymentops.payout.approved.v1",
  payoutRejected: "paymentops.payout.rejected.v1",
  payoutSubmitted: "paymentops.payout.submitted.v1",
  payoutSettled: "paymentops.payout.settled.v1",
  payoutFailed: "paymentops.payout.failed.v1",
  webhookDeliveryRequested: "paymentops.webhook.delivery_requested.v1",
  webhookDelivered: "paymentops.webhook.delivered.v1",
  webhookDeadLettered: "paymentops.webhook.dead_lettered.v1",
  reconciliationCompleted: "paymentops.reconciliation.completed.v1"
} as const;

export const paymentOpsWebhookHeaders = {
  signature: "PaymentOps-Signature",
  timestamp: "PaymentOps-Timestamp",
  eventId: "PaymentOps-Event-Id",
  deliveryId: "PaymentOps-Delivery-Id"
} as const;

export type PaymentOpsTopic = (typeof paymentOpsTopics)[keyof typeof paymentOpsTopics];

export interface WebhookSignatureInput {
  secret: string;
  timestamp: string;
  eventId: string;
  payload: string;
}

export function createEventEnvelope<TPayload extends Record<string, unknown>>(
  envelope: EventEnvelope<TPayload>
): EventEnvelope<TPayload> {
  return envelope;
}

export function createWebhookSignature(input: WebhookSignatureInput): string {
  const digest = createHmac("sha256", input.secret)
    .update(webhookSignaturePayload(input))
    .digest("hex");

  return `v1=${digest}`;
}

export function createWebhookSignatureHeaders(input: WebhookSignatureInput & { deliveryId: string }) {
  return {
    [paymentOpsWebhookHeaders.signature]: createWebhookSignature(input),
    [paymentOpsWebhookHeaders.timestamp]: input.timestamp,
    [paymentOpsWebhookHeaders.eventId]: input.eventId,
    [paymentOpsWebhookHeaders.deliveryId]: input.deliveryId
  };
}

export function verifyWebhookSignature(input: WebhookSignatureInput & { signature: string }): boolean {
  const expected = createWebhookSignature(input);
  const actual = Buffer.from(input.signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (actual.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actual, expectedBuffer);
}

function webhookSignaturePayload(input: WebhookSignatureInput): string {
  return `${input.timestamp}.${input.eventId}.${input.payload}`;
}
