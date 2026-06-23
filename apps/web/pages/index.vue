<script setup lang="ts">
import { useRuntimeConfig } from "#app";
import { paymentOpsPalette } from "@paymentops/ui";
import { storeToRefs } from "pinia";
import { computed, onMounted, reactive, watch } from "vue";
import { useFoundationStore } from "~/stores/foundation";

const config = useRuntimeConfig();
const apiBaseUrl = String(config.public.apiBaseUrl);
const devAdminToken = String(config.public.devAdminToken ?? "");
const store = useFoundationStore();
const { dashboard, loading, saving, error, message, revealedApiKeySecret } = storeToRefs(store);

const tenantForm = reactive({
  name: "",
  ownerEmail: ""
});
const clientForm = reactive({
  name: ""
});
const apiKeyForm = reactive({
  name: "",
  apiClientId: "",
  permissions: "payouts:create, payouts:read"
});
const webhookForm = reactive({
  url: "",
  description: "",
  eventSubscriptions: "payout.created.v1, payout.settled.v1"
});

onMounted(() => {
  void store.load(apiBaseUrl, devAdminToken);
});

watch(
  () => dashboard.value?.apiClients[0]?.id,
  (apiClientId) => {
    if (apiClientId && !apiKeyForm.apiClientId) {
      apiKeyForm.apiClientId = apiClientId;
    }
  },
  { immediate: true }
);

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

async function submitTenant() {
  await store.createTenant(apiBaseUrl, devAdminToken, {
    name: tenantForm.name,
    ownerEmail: tenantForm.ownerEmail || undefined
  });

  if (!error.value) {
    tenantForm.name = "";
    tenantForm.ownerEmail = "";
  }
}

async function submitApiClient() {
  await store.createApiClient(apiBaseUrl, devAdminToken, {
    name: clientForm.name
  });

  if (!error.value) {
    clientForm.name = "";
  }
}

async function submitApiKey() {
  await store.createApiKey(apiBaseUrl, devAdminToken, {
    name: apiKeyForm.name,
    apiClientId: apiKeyForm.apiClientId,
    permissions: csv(apiKeyForm.permissions)
  });

  if (!error.value) {
    apiKeyForm.name = "";
  }
}

async function submitWebhook() {
  await store.createWebhookEndpoint(apiBaseUrl, devAdminToken, {
    url: webhookForm.url,
    description: webhookForm.description || null,
    eventSubscriptions: csv(webhookForm.eventSubscriptions)
  });

  if (!error.value) {
    webhookForm.url = "";
    webhookForm.description = "";
  }
}

async function copySecret() {
  if (revealedApiKeySecret.value) {
    await navigator.clipboard.writeText(revealedApiKeySecret.value);
  }
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
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
        <a class="nav-item" href="#forms">Tenants</a>
        <a class="nav-item" href="#clients">API Clients</a>
        <a class="nav-item" href="#webhooks">Webhooks</a>
        <a class="nav-item" href="#audit">Audit</a>
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
          :disabled="loading"
          @click="store.load(apiBaseUrl, devAdminToken)"
        >
          <span aria-hidden="true">R</span>
        </button>
      </header>

      <p v-if="error" class="error-state">{{ error }}</p>
      <p v-if="message" class="success-state">{{ message }}</p>

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

      <section id="forms" class="form-grid" aria-label="Resource creation">
        <form class="panel form-panel" @submit.prevent="submitTenant">
          <header>
            <h2>Create Tenant</h2>
          </header>
          <label>
            <span>Name</span>
            <input v-model="tenantForm.name" required type="text" placeholder="Acme Marketplaces">
          </label>
          <label>
            <span>Owner email</span>
            <input v-model="tenantForm.ownerEmail" type="email" placeholder="owner@example.com">
          </label>
          <button class="primary-button" :disabled="saving" type="submit">Create</button>
        </form>

        <form id="clients" class="panel form-panel" @submit.prevent="submitApiClient">
          <header>
            <h2>Create API Client</h2>
          </header>
          <label>
            <span>Name</span>
            <input v-model="clientForm.name" required type="text" placeholder="Checkout Service">
          </label>
          <button class="primary-button" :disabled="saving || !dashboard" type="submit">Create</button>
        </form>

        <form class="panel form-panel" @submit.prevent="submitApiKey">
          <header>
            <h2>Mint API Key</h2>
          </header>
          <label>
            <span>Name</span>
            <input v-model="apiKeyForm.name" required type="text" placeholder="Production checkout key">
          </label>
          <label>
            <span>API client</span>
            <select v-model="apiKeyForm.apiClientId" required>
              <option value="" disabled>Select client</option>
              <option v-for="client in dashboard?.apiClients" :key="client.id" :value="client.id">
                {{ client.name }}
              </option>
            </select>
          </label>
          <label>
            <span>Permissions</span>
            <input v-model="apiKeyForm.permissions" required type="text">
          </label>
          <button class="primary-button" :disabled="saving || !dashboard" type="submit">Mint</button>
        </form>

        <form id="webhooks" class="panel form-panel" @submit.prevent="submitWebhook">
          <header>
            <h2>Register Webhook</h2>
          </header>
          <label>
            <span>URL</span>
            <input v-model="webhookForm.url" required type="url" placeholder="https://example.com/paymentops">
          </label>
          <label>
            <span>Description</span>
            <input v-model="webhookForm.description" type="text" placeholder="Payout events">
          </label>
          <label>
            <span>Events</span>
            <input v-model="webhookForm.eventSubscriptions" required type="text">
          </label>
          <button class="primary-button" :disabled="saving || !dashboard" type="submit">Register</button>
        </form>
      </section>

      <section v-if="revealedApiKeySecret" class="secret-reveal" aria-label="Minted API key secret">
        <div>
          <span>API key secret</span>
          <code>{{ revealedApiKeySecret }}</code>
        </div>
        <div class="button-row">
          <button class="secondary-button" type="button" @click="copySecret">Copy</button>
          <button class="secondary-button" type="button" @click="store.clearSecret()">Dismiss</button>
        </div>
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

        <article id="audit" class="panel wide">
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