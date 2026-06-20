export interface HealthResponse {
  status: "ok";
  service: string;
  environment: string;
  version: string;
  timestamp: string;
}

export interface EventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  tenantId: string;
  schemaVersion: number;
  occurredAt: string;
  traceId: string;
  correlationId: string;
  causationId: string;
  payload: TPayload;
}

export const foundationHealthContract = {
  method: "GET",
  path: "/health"
} as const;
