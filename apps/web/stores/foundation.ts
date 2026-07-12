import type {
  ApiClientSummary,
  AuthSessionResponse,
  ApprovalDecisionResponse,
  CreateApiClientRequest,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateMembershipRequest,
  CreatePayoutRequest,
  CreatePayoutResponse,
  CreateTenantRequest,
  CreateWebhookEndpointRequest,
  CreateWebhookEndpointResponse,
  ReplayWebhookDeliveryResponse,
  ReconciliationImportDetails,
  ReconciliationImportSummary,
  CreateReconciliationImportRequest,
  ResolveReconciliationDiscrepancyRequest,
  TenantDashboardResponse,
  TenantSummary,
  UpdateApiClientRequest,
  UpdateMembershipRequest,
  UpdateTenantRequest,
  UpdateWebhookEndpointRequest,
  UserMembershipSummary,
  WebhookEndpointSummary
} from "@paymentops/contracts";
import { defineStore } from "pinia";

interface FoundationState {
  session: AuthSessionResponse | null;
  dashboard: TenantDashboardResponse | null;
  activeTenantId: string | null;
  revealedApiKeySecret: string | null;
  revealedWebhookSecret: string | null;
  lastCreatedPayout: CreatePayoutResponse | null;
  lastApprovalDecision: ApprovalDecisionResponse | null;
  lastReplayedDelivery: ReplayWebhookDeliveryResponse | null;
  reconciliationImports: ReconciliationImportSummary[];
  selectedReconciliation: ReconciliationImportDetails | null;
  saving: boolean;
  loading: boolean;
  message: string | null;
  error: string | null;
}

export const useFoundationStore = defineStore("foundation", {
  state: (): FoundationState => ({
    session: null,
    dashboard: null,
    activeTenantId: null,
    revealedApiKeySecret: null,
    revealedWebhookSecret: null,
    lastCreatedPayout: null,
    lastApprovalDecision: null,
    lastReplayedDelivery: null,
    reconciliationImports: [],
    selectedReconciliation: null,
    saving: false,
    loading: false,
    message: null,
    error: null
  }),
  getters: {
    apiStatus: (state) => (state.dashboard ? "Ready" : "Loading"),
    tenantId: (state) => state.dashboard?.tenant?.id ?? state.activeTenantId
  },
  actions: {
    async loadSession(apiBaseUrl: string, adminCredential: string) {
      this.session = await $fetch<AuthSessionResponse>(apiBaseUrl + "/v1/auth/admin/session", {
        headers: adminHeaders(adminCredential)
      });
      return this.session;
    },

    async load(apiBaseUrl: string, devAdminToken: string, tenantId?: string | null) {
      this.loading = true;
      this.error = null;

      try {
        const requestedTenantId = tenantId ?? this.activeTenantId;
        const path = requestedTenantId
          ? `/v1/tenants/${requestedTenantId}/summary`
          : "/v1/demo/dashboard";
        this.dashboard = await $fetch<TenantDashboardResponse>(`${apiBaseUrl}${path}`, {
          headers: adminHeaders(devAdminToken)
        });
        if (this.activeTenantId && this.activeTenantId !== this.dashboard.tenant.id) {
          this.selectedReconciliation = null;
        }
        this.activeTenantId = this.dashboard.tenant.id;
        await this.loadReconciliation(apiBaseUrl, devAdminToken, this.dashboard.tenant.id);
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Unable to load dashboard";
      } finally {
        this.loading = false;
      }
    },

    async createTenant(apiBaseUrl: string, devAdminToken: string, body: CreateTenantRequest) {
      await this.mutate(async () => {
        const tenant = await $fetch<TenantSummary>(`${apiBaseUrl}/v1/tenants`, {
          method: "POST",
          headers: adminHeaders(devAdminToken),
          body
        });
        this.activeTenantId = tenant.id;
        this.message = `Created tenant ${tenant.name}`;
        await this.load(apiBaseUrl, devAdminToken, tenant.id);
      });
    },

    async updateTenant(apiBaseUrl: string, devAdminToken: string, body: UpdateTenantRequest) {
      const tenantId = requireTenantId(this.dashboard);
      await this.mutate(async () => {
        await $fetch<TenantSummary>(apiBaseUrl + "/v1/tenants/" + tenantId, {
          method: "PATCH",
          headers: adminHeaders(devAdminToken),
          body
        });
        this.message = "Updated tenant " + tenantId;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async createMembership(
      apiBaseUrl: string,
      devAdminToken: string,
      body: CreateMembershipRequest
    ) {
      const tenantId = requireTenantId(this.dashboard);
      await this.mutate(async () => {
        const membership = await $fetch<UserMembershipSummary>(
          apiBaseUrl + "/v1/tenants/" + tenantId + "/memberships",
          {
            method: "POST",
            headers: adminHeaders(devAdminToken),
            body
          }
        );
        this.message = "Added " + membership.email;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async updateMembership(
      apiBaseUrl: string,
      devAdminToken: string,
      membershipId: string,
      body: UpdateMembershipRequest
    ) {
      const tenantId = requireTenantId(this.dashboard);
      await this.mutate(async () => {
        await $fetch<UserMembershipSummary>(
          apiBaseUrl + "/v1/tenants/" + tenantId + "/memberships/" + membershipId,
          {
            method: "PATCH",
            headers: adminHeaders(devAdminToken),
            body
          }
        );
        this.message = "Updated tenant member";
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async createApiClient(apiBaseUrl: string, devAdminToken: string, body: CreateApiClientRequest) {
      const tenantId = requireTenantId(this.dashboard);

      await this.mutate(async () => {
        const client = await $fetch<ApiClientSummary>(
          `${apiBaseUrl}/v1/tenants/${tenantId}/api-clients`,
          {
            method: "POST",
            headers: adminHeaders(devAdminToken),
            body
          }
        );
        this.message = `Created API client ${client.name}`;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async updateApiClient(
      apiBaseUrl: string,
      devAdminToken: string,
      clientId: string,
      body: UpdateApiClientRequest
    ) {
      const tenantId = requireTenantId(this.dashboard);
      await this.mutate(async () => {
        await $fetch<ApiClientSummary>(
          apiBaseUrl + "/v1/tenants/" + tenantId + "/api-clients/" + clientId,
          {
            method: "PATCH",
            headers: adminHeaders(devAdminToken),
            body
          }
        );
        this.message = (body.status === "disabled" ? "Disabled" : "Enabled") + " API client";
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async createApiKey(apiBaseUrl: string, devAdminToken: string, body: CreateApiKeyRequest) {
      const tenantId = requireTenantId(this.dashboard);

      await this.mutate(async () => {
        const apiKey = await $fetch<CreateApiKeyResponse>(
          `${apiBaseUrl}/v1/tenants/${tenantId}/api-keys`,
          {
            method: "POST",
            headers: adminHeaders(devAdminToken),
            body
          }
        );
        this.revealedApiKeySecret = apiKey.secret;
        this.message = `Minted API key ${apiKey.name}`;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async rotateApiKey(apiBaseUrl: string, devAdminToken: string, apiKeyId: string) {
      const tenantId = requireTenantId(this.dashboard);
      await this.mutate(async () => {
        const apiKey = await $fetch<CreateApiKeyResponse>(
          apiBaseUrl + "/v1/tenants/" + tenantId + "/api-keys/" + apiKeyId + "/rotate",
          {
            method: "POST",
            headers: adminHeaders(devAdminToken),
            body: {}
          }
        );
        this.revealedApiKeySecret = apiKey.secret;
        this.message = "Rotated API key " + apiKeyId;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async revokeApiKey(apiBaseUrl: string, devAdminToken: string, apiKeyId: string) {
      const tenantId = requireTenantId(this.dashboard);
      await this.mutate(async () => {
        await $fetch(apiBaseUrl + "/v1/tenants/" + tenantId + "/api-keys/" + apiKeyId + "/revoke", {
          method: "POST",
          headers: adminHeaders(devAdminToken),
          body: {}
        });
        this.message = "Revoked API key " + apiKeyId;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async createWebhookEndpoint(
      apiBaseUrl: string,
      devAdminToken: string,
      body: CreateWebhookEndpointRequest
    ) {
      const tenantId = requireTenantId(this.dashboard);

      await this.mutate(async () => {
        const webhook = await $fetch<CreateWebhookEndpointResponse>(
          `${apiBaseUrl}/v1/tenants/${tenantId}/webhook-endpoints`,
          {
            method: "POST",
            headers: adminHeaders(devAdminToken),
            body
          }
        );
        this.revealedWebhookSecret = webhook.secret;
        this.message = `Registered webhook ${webhook.id}`;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async updateWebhookEndpoint(
      apiBaseUrl: string,
      devAdminToken: string,
      webhookId: string,
      body: UpdateWebhookEndpointRequest
    ) {
      const tenantId = requireTenantId(this.dashboard);
      await this.mutate(async () => {
        await $fetch<WebhookEndpointSummary>(
          apiBaseUrl + "/v1/tenants/" + tenantId + "/webhook-endpoints/" + webhookId,
          {
            method: "PATCH",
            headers: adminHeaders(devAdminToken),
            body
          }
        );
        this.message = "Updated webhook endpoint";
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async deleteWebhookEndpoint(apiBaseUrl: string, devAdminToken: string, webhookId: string) {
      const tenantId = requireTenantId(this.dashboard);
      await this.mutate(async () => {
        await $fetch(apiBaseUrl + "/v1/tenants/" + tenantId + "/webhook-endpoints/" + webhookId, {
          method: "DELETE",
          headers: adminHeaders(devAdminToken)
        });
        this.message = "Deleted webhook " + webhookId;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async createPayout(
      apiBaseUrl: string,
      devAdminToken: string,
      apiKeySecret: string,
      idempotencyKey: string,
      body: CreatePayoutRequest
    ) {
      const tenantId = requireTenantId(this.dashboard);

      await this.mutate(async () => {
        const payout = await $fetch<CreatePayoutResponse>(
          `${apiBaseUrl}/v1/tenants/${tenantId}/payouts`,
          {
            method: "POST",
            headers: apiKeyHeaders(apiKeySecret, idempotencyKey),
            body
          }
        );
        this.lastCreatedPayout = payout;
        this.message = payout.replayed
          ? `Replayed payout ${payout.id}`
          : `Created payout ${payout.id}`;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async approvePayout(
      apiBaseUrl: string,
      devAdminToken: string,
      payoutId: string,
      reason?: string | null
    ) {
      const tenantId = requireTenantId(this.dashboard);

      await this.mutate(async () => {
        this.lastApprovalDecision = await $fetch<ApprovalDecisionResponse>(
          `${apiBaseUrl}/v1/tenants/${tenantId}/approvals/${payoutId}/approve`,
          {
            method: "POST",
            headers: adminHeaders(devAdminToken),
            body: { reason: reason ?? null }
          }
        );
        this.message = `Approved payout ${payoutId}`;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async rejectPayout(
      apiBaseUrl: string,
      devAdminToken: string,
      payoutId: string,
      reason?: string | null
    ) {
      const tenantId = requireTenantId(this.dashboard);

      await this.mutate(async () => {
        this.lastApprovalDecision = await $fetch<ApprovalDecisionResponse>(
          `${apiBaseUrl}/v1/tenants/${tenantId}/approvals/${payoutId}/reject`,
          {
            method: "POST",
            headers: adminHeaders(devAdminToken),
            body: { reason: reason ?? null }
          }
        );
        this.message = `Rejected payout ${payoutId}`;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async loadReconciliation(apiBaseUrl: string, devAdminToken: string, tenantId: string) {
      this.reconciliationImports = await $fetch<ReconciliationImportSummary[]>(
        `${apiBaseUrl}/v1/tenants/${tenantId}/reconciliation/imports`,
        { headers: adminHeaders(devAdminToken) }
      );

      const selectedId =
        this.selectedReconciliation?.id ?? this.reconciliationImports[0]?.id ?? null;
      this.selectedReconciliation = selectedId
        ? await $fetch<ReconciliationImportDetails>(
            `${apiBaseUrl}/v1/tenants/${tenantId}/reconciliation/imports/${selectedId}`,
            { headers: adminHeaders(devAdminToken) }
          )
        : null;
    },

    async selectReconciliationImport(apiBaseUrl: string, devAdminToken: string, importId: string) {
      const tenantId = requireTenantId(this.dashboard);
      this.selectedReconciliation = await $fetch<ReconciliationImportDetails>(
        `${apiBaseUrl}/v1/tenants/${tenantId}/reconciliation/imports/${importId}`,
        { headers: adminHeaders(devAdminToken) }
      );
    },

    async createReconciliationImport(
      apiBaseUrl: string,
      devAdminToken: string,
      body: CreateReconciliationImportRequest
    ) {
      const tenantId = requireTenantId(this.dashboard);

      await this.mutate(async () => {
        this.selectedReconciliation = await $fetch<ReconciliationImportDetails>(
          `${apiBaseUrl}/v1/tenants/${tenantId}/reconciliation/imports`,
          {
            method: "POST",
            headers: adminHeaders(devAdminToken),
            body
          }
        );
        this.message = `Reconciled ${this.selectedReconciliation.matchedCount} of ${this.selectedReconciliation.rowCount} rows`;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async resolveReconciliationDiscrepancy(
      apiBaseUrl: string,
      devAdminToken: string,
      discrepancyId: string,
      body: ResolveReconciliationDiscrepancyRequest
    ) {
      const tenantId = requireTenantId(this.dashboard);
      const importId = this.selectedReconciliation?.id;

      await this.mutate(async () => {
        await $fetch(
          `${apiBaseUrl}/v1/tenants/${tenantId}/reconciliation/discrepancies/${discrepancyId}/resolve`,
          {
            method: "POST",
            headers: adminHeaders(devAdminToken),
            body
          }
        );
        this.message = `Resolved discrepancy ${discrepancyId}`;
        if (importId) {
          await this.selectReconciliationImport(apiBaseUrl, devAdminToken, importId);
        }
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async replayWebhookDelivery(apiBaseUrl: string, devAdminToken: string, deliveryId: string) {
      const tenantId = requireTenantId(this.dashboard);

      await this.mutate(async () => {
        this.lastReplayedDelivery = await $fetch<ReplayWebhookDeliveryResponse>(
          `${apiBaseUrl}/v1/tenants/${tenantId}/webhook-deliveries/${deliveryId}/replay`,
          {
            method: "POST",
            headers: adminHeaders(devAdminToken),
            body: {}
          }
        );
        this.message = `Queued webhook replay ${deliveryId}`;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    clearApiKeySecret() {
      this.revealedApiKeySecret = null;
    },

    clearWebhookSecret() {
      this.revealedWebhookSecret = null;
    },

    async mutate(operation: () => Promise<void>) {
      this.saving = true;
      this.error = null;
      this.message = null;

      try {
        await operation();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Request failed";
      } finally {
        this.saving = false;
      }
    }
  }
});

function adminHeaders(adminCredential: string): Record<string, string> {
  const credential = adminCredential.trim();
  if (!credential) return {};
  return credential.startsWith("Bearer ")
    ? { authorization: credential }
    : { "x-paymentops-dev-admin-token": credential };
}

function apiKeyHeaders(apiKeySecret: string, idempotencyKey: string): Record<string, string> {
  return {
    "x-api-key": apiKeySecret.trim(),
    "Idempotency-Key": idempotencyKey.trim()
  };
}

function requireTenantId(dashboard: TenantDashboardResponse | null): string {
  if (!dashboard) {
    throw new Error("Load a tenant before creating resources");
  }

  return dashboard.tenant.id;
}
