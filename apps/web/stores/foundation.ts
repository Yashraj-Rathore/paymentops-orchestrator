import type { TenantDashboardResponse } from "@paymentops/contracts";
import { defineStore } from "pinia";

export const useFoundationStore = defineStore("foundation", {
  state: () => ({
    dashboard: null as TenantDashboardResponse | null,
    loading: false,
    error: null as string | null
  }),
  getters: {
    apiStatus: (state) => (state.dashboard ? "Ready" : "Loading")
  },
  actions: {
    async load(apiBaseUrl: string) {
      this.loading = true;
      this.error = null;

      try {
        this.dashboard = await $fetch<TenantDashboardResponse>(`${apiBaseUrl}/v1/demo/dashboard`);
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Unable to load dashboard";
      } finally {
        this.loading = false;
      }
    }
  }
});