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

export type AuthRole = "operations_admin" | "merchant_owner" | "developer";

export type AuthPrincipalType = "api_key" | "jwt" | "dev_admin";

export interface AuthSessionResponse {
  type: AuthPrincipalType;
  subject: string;
  email: string | null;
  roles: AuthRole[];
  permissions: string[];
  tenantId: string | null;
  apiClientId: string | null;
  apiKeyId: string | null;
}

export type PayoutStatus =
  | "queued"
  | "processing"
  | "paid"
  | "failed"
  | "canceled"
  | "needs_approval";

export interface PayoutSummary {
  id: string;
  tenantId: string;
  providerPayoutId: string | null;
  amountMinor: number;
  currency: string;
  destinationAccount: string;
  reference: string | null;
  description: string | null;
  status: PayoutStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntrySummary {
  id: string;
  externalId: string;
  payoutId: string;
  direction: "debit" | "credit";
  account: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
}

export interface PayoutStatusHistorySummary {
  id: string;
  fromStatus: PayoutStatus | null;
  toStatus: PayoutStatus;
  reason: string | null;
  createdAt: string;
}

export interface OutboxEventSummary {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: "pending" | "published" | "failed" | "dead_letter";
  attempts: number;
  createdAt: string;
}

export interface PayoutDetailsResponse extends PayoutSummary {
  ledgerEntries: LedgerEntrySummary[];
  statusHistory: PayoutStatusHistorySummary[];
  outboxEvents: OutboxEventSummary[];
}

export interface CreatePayoutRequest {
  amountMinor: number;
  currency: string;
  destinationAccount: string;
  reference?: string | null;
  description?: string | null;
}

export interface CreatePayoutResponse extends PayoutDetailsResponse {
  idempotencyKey: string;
  replayed: boolean;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type RiskRuleType = "amount_threshold" | "blocked_destination";

export type RiskRuleAction = "require_approval";

export interface RiskRuleSummary {
  id: string;
  name: string;
  type: RiskRuleType;
  action: RiskRuleAction;
  status: "active" | "disabled";
  amountMinor: number | null;
  currency: string | null;
  destinationAccount: string | null;
  createdAt: string;
}

export interface PayoutApprovalSummary {
  id: string;
  payoutId: string;
  tenantId: string;
  status: ApprovalStatus;
  riskRuleId: string | null;
  riskReason: string;
  amountMinor: number;
  currency: string;
  destinationAccount: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface ApprovalDecisionRequest {
  reason?: string | null;
}

export interface ApprovalDecisionResponse extends PayoutApprovalSummary {
  payout: PayoutSummary;
}

export interface ProviderPayoutRequest {
  payoutId: string;
  tenantId: string;
  amountMinor: number;
  currency: string;
  destinationAccount: string;
  callbackUrl: string;
}

export interface ProviderPayoutResponse {
  providerPayoutId: string;
  status: "processing";
  callbackDelayMs: number;
}

export interface ProviderPayoutCallbackRequest {
  providerPayoutId: string;
  payoutId: string;
  tenantId: string;
  status: "paid" | "failed";
  reason: string;
}

export interface ProviderPayoutCallbackResponse {
  payoutId: string;
  status: PayoutStatus;
  accepted: boolean;
}

export interface MerchantWebhookEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>
> {
  id: string;
  type: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  createdAt: string;
  payload: TPayload;
}

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "dead_letter";

export interface WebhookDeliverySummary {
  id: string;
  webhookEndpointId: string;
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptedAt: string | null;
  deliveredAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
}

export interface ReplayWebhookDeliveryResponse extends WebhookDeliverySummary {
  replayed: true;
}

export type SettlementMatchStatus = "matched" | "missing" | "amount_mismatch";

export type ReconciliationDiscrepancyStatus = "open" | "resolved";

export interface SettlementRowSummary {
  id: string;
  providerPayoutId: string;
  payoutId: string | null;
  amountMinor: number;
  currency: string;
  providerStatus: string;
  settledAt: string | null;
  matchStatus: SettlementMatchStatus;
}

export interface ReconciliationDiscrepancySummary {
  id: string;
  settlementRowId: string;
  providerPayoutId: string;
  payoutId: string | null;
  type: Exclude<SettlementMatchStatus, "matched">;
  status: ReconciliationDiscrepancyStatus;
  expectedAmountMinor: number | null;
  actualAmountMinor: number;
  expectedCurrency: string | null;
  actualCurrency: string;
  resolutionNote: string | null;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ReconciliationImportSummary {
  id: string;
  tenantId: string;
  providerName: string;
  fileName: string;
  status: "processing" | "completed" | "failed";
  rowCount: number;
  matchedCount: number;
  discrepancyCount: number;
  importedBy: string;
  createdAt: string;
  completedAt: string | null;
}

export interface ReconciliationImportDetails extends ReconciliationImportSummary {
  rows: SettlementRowSummary[];
  discrepancies: ReconciliationDiscrepancySummary[];
}

export interface CreateReconciliationImportRequest {
  providerName: string;
  fileName: string;
  csv: string;
}

export interface ResolveReconciliationDiscrepancyRequest {
  resolutionNote: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  status: "active" | "suspended" | "archived";
  createdAt: string;
}

export type UserMembershipRole = Extract<AuthRole, "merchant_owner" | "developer">;

export interface UserMembershipSummary {
  id: string;
  email: string;
  role: UserMembershipRole;
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

export interface CreateWebhookEndpointResponse extends WebhookEndpointSummary {
  secret: string;
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
  webhookDeliveries: WebhookDeliverySummary[];
  riskRules: RiskRuleSummary[];
  approvals: PayoutApprovalSummary[];
  payouts: PayoutSummary[];
  ledgerEntries: LedgerEntrySummary[];
  outboxEvents: OutboxEventSummary[];
  auditLogs: AuditLogSummary[];
  metrics: {
    members: number;
    apiClients: number;
    activeApiKeys: number;
    webhookEndpoints: number;
    webhookDeliveries: number;
    failedWebhookDeliveries: number;
    riskRules: number;
    pendingApprovals: number;
    payouts: number;
    ledgerEntries: number;
    pendingOutboxEvents: number;
    auditEvents: number;
  };
}

export interface CreateTenantRequest {
  name: string;
  ownerEmail?: string;
}

export interface UpdateTenantRequest {
  name?: string;
  status?: TenantSummary["status"];
}

export interface CreateMembershipRequest {
  email: string;
  role: UserMembershipRole;
  status?: UserMembershipSummary["status"];
}

export interface UpdateMembershipRequest {
  role?: UserMembershipRole;
  status?: UserMembershipSummary["status"];
}

export interface CreateApiClientRequest {
  name: string;
}

export interface UpdateApiClientRequest {
  status: ApiClientSummary["status"];
}

export interface CreateApiKeyRequest {
  apiClientId: string;
  name: string;
  permissions?: string[];
  expiresAt?: string | null;
}

export interface RotateApiKeyRequest {
  name?: string;
  permissions?: string[];
  expiresAt?: string | null;
}

export interface RevokeApiKeyResponse {
  id: string;
  status: "revoked";
  revokedAt: string;
}

export interface CreateWebhookEndpointRequest {
  url: string;
  description?: string | null;
  eventSubscriptions?: string[];
}

export interface UpdateWebhookEndpointRequest {
  url?: string;
  description?: string | null;
  eventSubscriptions?: string[];
  status?: WebhookEndpointSummary["status"];
}

export interface DeleteWebhookEndpointResponse {
  id: string;
  deleted: true;
  deletedAt: string;
}

export const foundationHealthContract = {
  method: "GET",
  path: "/health"
} as const;
