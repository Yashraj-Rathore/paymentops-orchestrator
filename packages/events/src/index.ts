import type { EventEnvelope } from "@paymentops/contracts";

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

export type PaymentOpsTopic = (typeof paymentOpsTopics)[keyof typeof paymentOpsTopics];

export function createEventEnvelope<TPayload extends Record<string, unknown>>(
  envelope: EventEnvelope<TPayload>
): EventEnvelope<TPayload> {
  return envelope;
}
