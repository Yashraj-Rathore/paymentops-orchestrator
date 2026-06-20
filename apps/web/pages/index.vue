<script setup lang="ts">
import { useRuntimeConfig } from "#app";
import { paymentOpsPalette } from "@paymentops/ui";
import { storeToRefs } from "pinia";
import { computed, onMounted } from "vue";
import { useFoundationStore } from "~/stores/foundation";

const config = useRuntimeConfig();
const store = useFoundationStore();
const { dashboard, loading, error } = storeToRefs(store);

onMounted(() => {
  void store.load(config.public.apiBaseUrl);
});

const lanes = computed(() => [
  {
    label: "Tenant",
    value: dashboard.value?.tenant.name ?? "Loading",
    state: dashboard.value?.tenant.status ?? "pending"
  },
  {
    label: "API clients",
    value: String(dashboard.value?.metrics.apiClients ?? 0),
    state: "active"
  },
  {
    label: "API keys",
    value: String(dashboard.value?.metrics.activeApiKeys ?? 0),
    state: "one-time reveal"
  },
  {
    label: "Webhooks",
    value: String(dashboard.value?.metrics.webhookEndpoints ?? 0),
    state: "signed"
  }
]);
</script>

<template>
  <main class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">P</span>
        <div>
          <strong>PaymentOps</strong>
          <span>Orchestrator</span>
        </div>
      </div>

      <nav class="nav" aria-label="Primary">
        <a class="nav-item active" href="#">Dashboard</a>
        <a class="nav-item" href="#">Tenants</a>
        <a class="nav-item" href="#">API Clients</a>
        <a class="nav-item" href="#">Webhooks</a>
        <a class="nav-item" href="#">Audit</a>
      </nav>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ dashboard?.tenant.id ?? "mer_demo_northstar" }}</p>
          <h1>{{ dashboard?.tenant.name ?? "Operations Command Center" }}</h1>
        </div>
        <button
          class="icon-button"
          type="button"
          title="Refresh dashboard"
          @click="store.load(config.public.apiBaseUrl)"
        >
          <span aria-hidden="true">?</span>
        </button>
      </header>

      <p v-if="error" class="error-state">{{ error }}</p>

      <section class="status-grid" aria-label="Tenant status">
        <article class="metric">
          <span>Members</span>
          <strong>{{ dashboard?.metrics.members ?? 0 }}</strong>
          <small>{{ loading ? "Loading" : "Tenant-scoped roles" }}</small>
        </article>
        <article class="metric">
          <span>API clients</span>
          <strong>{{ dashboard?.metrics.apiClients ?? 0 }}</strong>
          <small>Server integrations</small>
        </article>
        <article class="metric">
          <span>API keys</span>
          <strong>{{ dashboard?.metrics.activeApiKeys ?? 0 }}</strong>
          <small>Hashed at rest</small>
        </article>
        <article class="metric">
          <span>Webhook endpoints</span>
          <strong>{{ dashboard?.metrics.webhookEndpoints ?? 0 }}</strong>
          <small>Signed outbound events</small>
        </article>
      </section>

      <section class="lanes" aria-label="Workflow lanes">
        <article v-for="lane in lanes" :key="lane.label" class="lane">
          <div>
            <span class="lane-state" :style="{ color: paymentOpsPalette.action }">
              {{ lane.state }}
            </span>
            <h2>{{ lane.label }}</h2>
          </div>
          <p>{{ lane.value }}</p>
        </article>
      </section>

      <section class="data-grid" aria-label="Configured resources">
        <article class="panel">
          <header>
            <h2>API Clients</h2>
          </header>
          <div v-for="client in dashboard?.apiClients" :key="client.id" class="row-item">
            <div>
              <strong>{{ client.name }}</strong>
              <span>{{ client.id }}</span>
            </div>
            <small>{{ client.status }}</small>
          </div>
        </article>

        <article class="panel">
          <header>
            <h2>API Keys</h2>
          </header>
          <div v-for="apiKey in dashboard?.apiKeys" :key="apiKey.id" class="row-item">
            <div>
              <strong>{{ apiKey.name }}</strong>
              <span>{{ apiKey.keyPrefix }}...</span>
            </div>
            <small>{{ apiKey.permissions.join(", ") }}</small>
          </div>
        </article>

        <article class="panel wide">
          <header>
            <h2>Webhook Endpoints</h2>
          </header>
          <div v-for="webhook in dashboard?.webhookEndpoints" :key="webhook.id" class="row-item">
            <div>
              <strong>{{ webhook.description ?? webhook.id }}</strong>
              <span>{{ webhook.url }}</span>
            </div>
            <small>{{ webhook.eventSubscriptions.join(", ") }}</small>
          </div>
        </article>

        <article class="panel wide">
          <header>
            <h2>Audit Trail</h2>
          </header>
          <div v-for="audit in dashboard?.auditLogs" :key="audit.id" class="row-item">
            <div>
              <strong>{{ audit.action }}</strong>
              <span>{{ audit.resourceType }} / {{ audit.resourceId }}</span>
            </div>
            <small>{{ new Date(audit.createdAt).toLocaleString() }}</small>
          </div>
        </article>
      </section>
    </section>
  </main>
</template>