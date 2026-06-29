export const asyncQueueNames = {
  payoutDispatch: "paymentops-payout-dispatch",
  webhookDelivery: "paymentops-webhook-delivery",
  deadLetter: "paymentops-dead-letter"
} as const;

export const asyncJobNames = {
  payoutDispatch: "dispatch-payout",
  webhookDelivery: "deliver-webhook",
  deadLetter: "dead-letter"
} as const;

export const asyncRetryPolicy = {
  attempts: 5,
  backoffMs: 1000
} as const;

export interface PayoutDispatchJobData {
  outboxEventId: string;
}

export interface WebhookDeliveryJobData {
  deliveryExternalId: string;
}

export interface DeadLetterJobData {
  sourceQueue: string;
  sourceJobId: string;
  resourceId: string;
  error: string;
  failedAt: string;
}
