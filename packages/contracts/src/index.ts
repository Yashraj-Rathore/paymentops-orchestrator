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

export interface TenantSummary {
  id: string;
  name: string;
  status: "active" | "suspended" | "archived";
  createdAt: string;
}

export interface UserMembershipSummary {
  id: string;
  email: string;
  role: string;
  status: "active" | "invited" | "disabled";
  createdAt: string;
}

export interface ApiClientSummary {
  id: string;
  name: string;
  status: "active" | "disabled";
  createdAt: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  createdAt: string;
  expiresAt: string | null;
}

export interface CreateApiKeyResponse extends ApiKeySummary {
  secret: string;
}

export interface WebhookEndpointSummary {
  id: string;
  url: string;
  description: string | null;
  eventSubscriptions: string[];
  status: "active" | "disabled";
  createdAt: string;
}

export interface AuditLogSummary {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  createdAt: string;
}

export interface TenantDashboardResponse {
  tenant: TenantSummary;
  memberships: UserMembershipSummary[];
  apiClients: ApiClientSummary[];
  apiKeys: ApiKeySummary[];
  webhookEndpoints: WebhookEndpointSummary[];
  auditLogs: AuditLogSummary[];
  metrics: {
    members: number;
    apiClients: number;
    activeApiKeys: number;
    webhookEndpoints: number;
    auditEvents: number;
  };
}

export interface CreateTenantRequest {
  name: string;
  ownerEmail?: string;
}

export interface CreateApiClientRequest {
  name: string;
}

export interface CreateApiKeyRequest {
  apiClientId: string;
  name: string;
  permissions?: string[];
  expiresAt?: string | null;
}

export interface CreateWebhookEndpointRequest {
  url: string;
  description?: string | null;
  eventSubscriptions?: string[];
}

export const foundationHealthContract = {
  method: "GET",
  path: "/health"
} as const;