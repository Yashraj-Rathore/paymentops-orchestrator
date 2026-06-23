import type {
  ApiClientSummary,
  CreateApiClientRequest,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateTenantRequest,
  CreateWebhookEndpointRequest,
  TenantDashboardResponse,
  TenantSummary,
  WebhookEndpointSummary
} from "@paymentops/contracts";
import { defineStore } from "pinia";

interface FoundationState {
  dashboard: TenantDashboardResponse | null;
  activeTenantId: string | null;
  revealedApiKeySecret: string | null;
  saving: boolean;
  loading: boolean;
  message: string | null;
  error: string | null;
}

export const useFoundationStore = defineStore("foundation", {
  state: (): FoundationState => ({
    dashboard: null,
    activeTenantId: null,
    revealedApiKeySecret: null,
    saving: false,
    loading: false,
    message: null,
    error: null
  }),
  getters: {
    apiStatus: (state) => (state.dashboard ? "Ready" : "Loading"),
    tenantId: (state) => state.dashboard?.tenant.id ?? state.activeTenantId
  },
  actions: {
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
        this.activeTenantId = this.dashboard.tenant.id;
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

    async createApiClient(apiBaseUrl: string, devAdminToken: string, body: CreateApiClientRequest) {
      const tenantId = requireTenantId(this.dashboard);

      await this.mutate(async () => {
        const client = await $fetch<ApiClientSummary>(`${apiBaseUrl}/v1/tenants/${tenantId}/api-clients`, {
          method: "POST",
          headers: adminHeaders(devAdminToken),
          body
        });
        this.message = `Created API client ${client.name}`;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    async createApiKey(apiBaseUrl: string, devAdminToken: string, body: CreateApiKeyRequest) {
      const tenantId = requireTenantId(this.dashboard);

      await this.mutate(async () => {
        const apiKey = await $fetch<CreateApiKeyResponse>(`${apiBaseUrl}/v1/tenants/${tenantId}/api-keys`, {
          method: "POST",
          headers: adminHeaders(devAdminToken),
          body
        });
        this.revealedApiKeySecret = apiKey.secret;
        this.message = `Minted API key ${apiKey.name}`;
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
        const webhook = await $fetch<WebhookEndpointSummary>(
          `${apiBaseUrl}/v1/tenants/${tenantId}/webhook-endpoints`,
          {
            method: "POST",
            headers: adminHeaders(devAdminToken),
            body
          }
        );
        this.message = `Registered webhook ${webhook.id}`;
        await this.load(apiBaseUrl, devAdminToken, tenantId);
      });
    },

    clearSecret() {
      this.revealedApiKeySecret = null;
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

function adminHeaders(devAdminToken: string): Record<string, string> {
  return devAdminToken.trim().length > 0
    ? { "x-paymentops-dev-admin-token": devAdminToken.trim() }
    : {};
}

function requireTenantId(dashboard: TenantDashboardResponse | null): string {
  if (!dashboard) {
    throw new Error("Load a tenant before creating resources");
  }

  return dashboard.tenant.id;
}