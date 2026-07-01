<script setup lang="ts">
import { useRuntimeConfig } from "#app";
import {
  Activity,
  AlertCircle,
  Banknote,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Code2,
  Copy,
  Database,
  FileSearch,
  FileUp,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Menu,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Webhook,
  X
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useFoundationStore } from "~/stores/foundation";

type ViewId =
  | "overview"
  | "payouts"
  | "approvals"
  | "developers"
  | "webhooks"
  | "reconciliation"
  | "audit";
type ActionId = "tenant" | "client" | "apiKey" | "payout" | "webhook" | "settlement";

const config = useRuntimeConfig();
const apiBaseUrl = String(config.public.apiBaseUrl);
const devAdminToken = String(config.public.devAdminToken ?? "");
const store = useFoundationStore();
const {
  dashboard,
  loading,
  saving,
  error,
  message,
  revealedApiKeySecret,
  revealedWebhookSecret,
  reconciliationImports,
  selectedReconciliation
} = storeToRefs(store);

const activeView = ref<ViewId>("overview");
const activeAction = ref<ActionId | null>(null);
const auditTab = ref<"ledger" | "events" | "audit">("ledger");
const mobileNavOpen = ref(false);
const searchQuery = ref("");
const toastVisible = ref(false);
const copiedSecret = ref(false);
const settlementFileInput = ref<HTMLInputElement | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const tenantForm = reactive({ name: "", ownerEmail: "" });
const clientForm = reactive({ name: "" });
const apiKeyForm = reactive({
  name: "",
  apiClientId: "",
  permissions: "payouts:create, payouts:read"
});
const webhookForm = reactive({
  url: "",
  description: "",
  eventSubscriptions: "payout.created.v1, payout.processing.v1, payout.paid.v1, payout.failed.v1"
});
const payoutForm = reactive({
  amountMinor: 125000,
  currency: "USD",
  destinationAccount: "acct_demo_merchant_bank",
  reference: "",
  description: "",
  apiKeySecret: "",
  idempotencyKey: ""
});
const reconciliationForm = reactive({
  providerName: "PaymentOps Provider Simulator",
  fileName: "",
  csv: ""
});

const navItems = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "payouts" as const, label: "Payouts", icon: CircleDollarSign },
  { id: "approvals" as const, label: "Approvals", icon: ClipboardCheck },
  { id: "developers" as const, label: "Developers", icon: Code2 },
  { id: "webhooks" as const, label: "Webhooks", icon: Webhook },
  { id: "reconciliation" as const, label: "Reconciliation", icon: FileSearch },
  { id: "audit" as const, label: "Audit & ledger", icon: Database }
];

const actionLabels: Record<ActionId, string> = {
  tenant: "Create tenant",
  client: "Create API client",
  apiKey: "Mint API key",
  payout: "Create payout",
  webhook: "Register webhook",
  settlement: "Import settlement"
};

const pageTitle = computed(
  () => navItems.find((item) => item.id === activeView.value)?.label ?? "Overview"
);
const query = computed(() => searchQuery.value.trim().toLowerCase());
const payoutVolume = computed(() =>
  (dashboard.value?.payouts ?? []).reduce((sum, payout) => sum + payout.amountMinor, 0)
);
const paidPayouts = computed(
  () => dashboard.value?.payouts.filter((payout) => payout.status === "paid").length ?? 0
);
const attentionCount = computed(
  () =>
    (dashboard.value?.metrics.pendingApprovals ?? 0) +
    (dashboard.value?.metrics.failedWebhookDeliveries ?? 0) +
    (selectedReconciliation.value?.discrepancyCount ?? 0)
);
const deliveryRate = computed(() => {
  const deliveries = dashboard.value?.webhookDeliveries ?? [];
  if (deliveries.length === 0) return 100;
  return Math.round(
    (deliveries.filter((delivery) => delivery.status === "delivered").length / deliveries.length) *
      100
  );
});
const filteredPayouts = computed(() => {
  const payouts = dashboard.value?.payouts ?? [];
  if (!query.value) return payouts;
  return payouts.filter((payout) =>
    [payout.id, payout.status, payout.destinationAccount, payout.reference, payout.providerPayoutId]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query.value))
  );
});
const filteredDeliveries = computed(() => {
  const deliveries = dashboard.value?.webhookDeliveries ?? [];
  if (!query.value) return deliveries;
  return deliveries.filter((delivery) =>
    [delivery.id, delivery.eventType, delivery.aggregateId, delivery.status]
      .join(" ")
      .toLowerCase()
      .includes(query.value)
  );
});
const revealedSecret = computed(() => {
  if (revealedApiKeySecret.value) {
    return { label: "API key secret", value: revealedApiKeySecret.value, kind: "apiKey" as const };
  }
  if (revealedWebhookSecret.value) {
    return {
      label: "Webhook signing secret",
      value: revealedWebhookSecret.value,
      kind: "webhook" as const
    };
  }
  return null;
});

onMounted(() => {
  payoutForm.idempotencyKey = newIdempotencyKey();
  void store.load(apiBaseUrl, devAdminToken);
});

onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer);
});

watch(
  () => dashboard.value?.apiClients[0]?.id,
  (apiClientId) => {
    if (apiClientId && !apiKeyForm.apiClientId) apiKeyForm.apiClientId = apiClientId;
  },
  { immediate: true }
);

watch(revealedApiKeySecret, (secret) => {
  if (secret) payoutForm.apiKeySecret = secret;
});

watch(message, (value) => {
  if (!value) return;
  toastVisible.value = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 4500);
});

function navigate(view: ViewId) {
  activeView.value = view;
  mobileNavOpen.value = false;
  searchQuery.value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openAction(action: ActionId) {
  activeAction.value = action;
  mobileNavOpen.value = false;
}

function closeAction() {
  activeAction.value = null;
}

async function refreshDashboard() {
  await store.load(apiBaseUrl, devAdminToken);
}

async function submitTenant() {
  await store.createTenant(apiBaseUrl, devAdminToken, {
    name: tenantForm.name,
    ownerEmail: tenantForm.ownerEmail || undefined
  });
  if (!error.value) {
    tenantForm.name = "";
    tenantForm.ownerEmail = "";
    closeAction();
  }
}

async function submitApiClient() {
  await store.createApiClient(apiBaseUrl, devAdminToken, { name: clientForm.name });
  if (!error.value) {
    clientForm.name = "";
    closeAction();
  }
}

async function submitApiKey() {
  store.clearWebhookSecret();
  await store.createApiKey(apiBaseUrl, devAdminToken, {
    name: apiKeyForm.name,
    apiClientId: apiKeyForm.apiClientId,
    permissions: csv(apiKeyForm.permissions)
  });
  if (!error.value) {
    apiKeyForm.name = "";
    closeAction();
  }
}

async function submitWebhook() {
  store.clearApiKeySecret();
  await store.createWebhookEndpoint(apiBaseUrl, devAdminToken, {
    url: webhookForm.url,
    description: webhookForm.description || null,
    eventSubscriptions: csv(webhookForm.eventSubscriptions)
  });
  if (!error.value) {
    webhookForm.url = "";
    webhookForm.description = "";
    closeAction();
  }
}

async function submitPayout() {
  await store.createPayout(
    apiBaseUrl,
    devAdminToken,
    payoutForm.apiKeySecret,
    payoutForm.idempotencyKey,
    {
      amountMinor: Number(payoutForm.amountMinor),
      currency: payoutForm.currency,
      destinationAccount: payoutForm.destinationAccount,
      reference: payoutForm.reference || null,
      description: payoutForm.description || null
    }
  );
  if (!error.value) {
    payoutForm.reference = "";
    payoutForm.description = "";
    payoutForm.idempotencyKey = newIdempotencyKey();
    closeAction();
  }
}

async function approvePayout(payoutId: string) {
  await store.approvePayout(
    apiBaseUrl,
    devAdminToken,
    payoutId,
    "Approved from the operations dashboard"
  );
}

async function rejectPayout(payoutId: string) {
  await store.rejectPayout(
    apiBaseUrl,
    devAdminToken,
    payoutId,
    "Rejected from the operations dashboard"
  );
}

async function replayWebhookDelivery(deliveryId: string) {
  await store.replayWebhookDelivery(apiBaseUrl, devAdminToken, deliveryId);
}

async function handleSettlementFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  reconciliationForm.fileName = file.name;
  reconciliationForm.csv = await file.text();
}

function loadSampleSettlement() {
  const settledAt = new Date().toISOString();
  const payoutRows = (dashboard.value?.payouts ?? [])
    .filter((payout) => payout.providerPayoutId)
    .slice(0, 2)
    .map((payout, index) =>
      [
        payout.providerPayoutId,
        index === 0 ? payout.amountMinor : payout.amountMinor + 100,
        payout.currency,
        "paid",
        settledAt
      ].join(",")
    );

  reconciliationForm.fileName = "demo-settlement.csv";
  reconciliationForm.csv = [
    "provider_payout_id,amount_minor,currency,status,settled_at",
    ...payoutRows,
    ["provider_missing_demo", 1750, "USD", "paid", settledAt].join(",")
  ].join("\n");
}

async function submitReconciliation() {
  await store.createReconciliationImport(apiBaseUrl, devAdminToken, {
    providerName: reconciliationForm.providerName,
    fileName: reconciliationForm.fileName,
    csv: reconciliationForm.csv
  });
  if (!error.value) {
    reconciliationForm.fileName = "";
    reconciliationForm.csv = "";
    if (settlementFileInput.value) settlementFileInput.value.value = "";
    closeAction();
    activeView.value = "reconciliation";
  }
}

async function selectReconciliationImport(importId: string) {
  await store.selectReconciliationImport(apiBaseUrl, devAdminToken, importId);
}

async function copySecret() {
  if (!revealedSecret.value) return;
  await navigator.clipboard.writeText(revealedSecret.value.value);
  copiedSecret.value = true;
  setTimeout(() => {
    copiedSecret.value = false;
  }, 1800);
}

function dismissSecret() {
  if (revealedSecret.value?.kind === "apiKey") store.clearApiKeySecret();
  if (revealedSecret.value?.kind === "webhook") store.clearWebhookSecret();
  copiedSecret.value = false;
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatMinor(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(amountMinor / 100);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusClass(status: string): string {
  return "status-" + status.toLowerCase().replaceAll("_", "-");
}

function newIdempotencyKey(): string {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return "idem_" + globalThis.crypto.randomUUID();
  }
  return "idem_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}
</script>

<template>
  <main class="app-shell">
    <div
      v-if="mobileNavOpen"
      class="mobile-scrim"
      aria-hidden="true"
      @click="mobileNavOpen = false"
    />

    <aside class="app-sidebar" :class="{ 'is-open': mobileNavOpen }">
      <div class="brand-lockup">
        <div class="brand-symbol" aria-hidden="true"><Activity :size="19" /></div>
        <div class="brand-copy">
          <strong>PaymentOps</strong>
          <span>Orchestrator</span>
        </div>
        <button
          class="icon-button sidebar-close"
          type="button"
          title="Close navigation"
          @click="mobileNavOpen = false"
        >
          <X :size="18" />
        </button>
      </div>

      <div class="tenant-switcher">
        <div class="tenant-avatar">{{ dashboard?.tenant.name?.slice(0, 1) ?? "N" }}</div>
        <div>
          <strong>{{ dashboard?.tenant.name ?? "Northstar" }}</strong>
          <span>{{ dashboard?.tenant.id ?? "Loading tenant" }}</span>
        </div>
        <span class="status-dot" :class="{ online: Boolean(dashboard) }" />
      </div>

      <nav class="primary-nav" aria-label="Primary navigation">
        <span class="nav-label">Workspace</span>
        <button
          v-for="item in navItems"
          :key="item.id"
          class="nav-button"
          :class="{ active: activeView === item.id }"
          type="button"
          @click="navigate(item.id)"
        >
          <component :is="item.icon" :size="18" />
          <span>{{ item.label }}</span>
          <span
            v-if="item.id === 'approvals' && (dashboard?.metrics.pendingApprovals ?? 0) > 0"
            class="nav-count"
          >
            {{ dashboard?.metrics.pendingApprovals }}
          </span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="environment-row">
          <span class="environment-dot" :class="{ online: Boolean(dashboard) }" />
          <div>
            <strong>Development</strong>
            <span>{{ dashboard ? "API connected" : "API unavailable" }}</span>
          </div>
        </div>
        <button class="icon-button dark" type="button" title="Workspace settings">
          <Settings2 :size="18" />
        </button>
      </div>
    </aside>

    <section class="main-workspace">
      <header class="workspace-header">
        <div class="header-title">
          <button
            class="icon-button mobile-menu"
            type="button"
            title="Open navigation"
            @click="mobileNavOpen = true"
          >
            <Menu :size="20" />
          </button>
          <div>
            <p>{{ dashboard?.tenant.name ?? "Payment operations" }}</p>
            <h1>{{ pageTitle }}</h1>
          </div>
        </div>

        <div class="header-controls">
          <label class="global-search">
            <Search :size="17" />
            <input v-model="searchQuery" type="search" placeholder="Search current view">
          </label>
          <button
            class="icon-button"
            type="button"
            title="Refresh dashboard"
            :disabled="loading"
            @click="refreshDashboard"
          >
            <RefreshCw :size="18" :class="{ spin: loading }" />
          </button>
          <button class="primary-button header-action" type="button" @click="openAction('payout')">
            <Plus :size="17" />
            <span>New payout</span>
          </button>
        </div>
      </header>

      <div class="workspace-content">
        <div v-if="error" class="notice error-notice" role="alert">
          <AlertCircle :size="18" />
          <span>{{ error }}</span>
          <button class="icon-button subtle" type="button" title="Retry" @click="refreshDashboard">
            <RefreshCw :size="16" />
          </button>
        </div>

        <div class="quick-actions" aria-label="Quick actions">
          <button type="button" @click="openAction('payout')">
            <CircleDollarSign :size="17" />
            Create payout
          </button>
          <button type="button" @click="openAction('apiKey')">
            <KeyRound :size="17" />
            Mint API key
          </button>
          <button type="button" @click="openAction('webhook')">
            <Webhook :size="17" />
            Add webhook
          </button>
          <button type="button" @click="openAction('settlement')">
            <FileUp :size="17" />
            Import settlement
          </button>
        </div>

        <template v-if="activeView === 'overview'">
          <section class="metric-grid" aria-label="Operations summary">
            <article class="metric-card">
              <div class="metric-icon blue"><Banknote :size="19" /></div>
              <div class="metric-label">
                <span>Payout volume</span>
                <small>Recent activity</small>
              </div>
              <strong>{{ formatMinor(payoutVolume, "USD") }}</strong>
              <span class="metric-foot positive">
                <CheckCircle2 :size="14" /> {{ paidPayouts }} paid
              </span>
            </article>
            <article class="metric-card">
              <div class="metric-icon green"><Gauge :size="19" /></div>
              <div class="metric-label">
                <span>Delivery health</span>
                <small>Merchant webhooks</small>
              </div>
              <strong>{{ deliveryRate }}%</strong>
              <span class="metric-foot">{{ dashboard?.metrics.webhookDeliveries ?? 0 }} attempts</span>
            </article>
            <article class="metric-card">
              <div class="metric-icon amber"><Clock3 :size="19" /></div>
              <div class="metric-label">
                <span>Pending approvals</span>
                <small>Risk review</small>
              </div>
              <strong>{{ dashboard?.metrics.pendingApprovals ?? 0 }}</strong>
              <button class="metric-link" type="button" @click="navigate('approvals')">
                Review queue <ChevronRight :size="14" />
              </button>
            </article>
            <article class="metric-card">
              <div class="metric-icon red"><Bell :size="19" /></div>
              <div class="metric-label">
                <span>Needs attention</span>
                <small>Across operations</small>
              </div>
              <strong>{{ attentionCount }}</strong>
              <span class="metric-foot" :class="{ negative: attentionCount > 0 }">
                {{ attentionCount > 0 ? "Action required" : "All clear" }}
              </span>
            </article>
          </section>

          <section class="overview-grid">
            <article class="surface span-two">
              <header class="section-header">
                <div>
                  <p>Money movement</p>
                  <h2>Recent payouts</h2>
                </div>
                <button class="text-button" type="button" @click="navigate('payouts')">
                  View all <ChevronRight :size="15" />
                </button>
              </header>
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Payout</th>
                      <th>Destination</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="payout in (dashboard?.payouts ?? []).slice(0, 6)" :key="payout.id">
                      <td>
                        <strong>{{ payout.reference ?? "Payout" }}</strong>
                        <span>{{ payout.id }}</span>
                      </td>
                      <td>
                        <span class="mono">{{ payout.destinationAccount }}</span>
                      </td>
                      <td>
                        <strong>{{ formatMinor(payout.amountMinor, payout.currency) }}</strong>
                      </td>
                      <td>
                        <span class="status-badge" :class="statusClass(payout.status)">
                          <i />{{ payout.status.replaceAll("_", " ") }}
                        </span>
                      </td>
                      <td>{{ formatDate(payout.updatedAt) }}</td>
                    </tr>
                  </tbody>
                </table>
                <div v-if="!dashboard?.payouts.length" class="empty-state">
                  <CircleDollarSign :size="22" />
                  <strong>No payouts yet</strong>
                  <button class="text-button" type="button" @click="openAction('payout')">
                    Create the first payout
                  </button>
                </div>
              </div>
            </article>

            <article class="surface attention-panel">
              <header class="section-header">
                <div>
                  <p>Control queue</p>
                  <h2>Attention</h2>
                </div>
                <span class="count-badge">{{ attentionCount }}</span>
              </header>
              <button class="attention-row" type="button" @click="navigate('approvals')">
                <span class="attention-icon amber"><ClipboardCheck :size="17" /></span>
                <span>
                  <strong>Payout approvals</strong>
                  <small>{{ dashboard?.metrics.pendingApprovals ?? 0 }} waiting</small>
                </span>
                <ChevronRight :size="16" />
              </button>
              <button class="attention-row" type="button" @click="navigate('webhooks')">
                <span class="attention-icon red"><Webhook :size="17" /></span>
                <span>
                  <strong>Webhook failures</strong>
                  <small>{{ dashboard?.metrics.failedWebhookDeliveries ?? 0 }} unresolved</small>
                </span>
                <ChevronRight :size="16" />
              </button>
              <button class="attention-row" type="button" @click="navigate('reconciliation')">
                <span class="attention-icon blue"><FileSearch :size="17" /></span>
                <span>
                  <strong>Discrepancies</strong>
                  <small>{{ selectedReconciliation?.discrepancyCount ?? 0 }} open</small>
                </span>
                <ChevronRight :size="16" />
              </button>
            </article>

            <article class="surface system-panel">
              <header class="section-header">
                <div>
                  <p>Infrastructure</p>
                  <h2>System signals</h2>
                </div>
                <span class="live-indicator"><i /> Live</span>
              </header>
              <div class="signal-row">
                <span><Server :size="17" /> API</span>
                <strong class="positive">Operational</strong>
              </div>
              <div class="signal-row">
                <span><Database :size="17" /> Outbox queue</span>
                <strong>{{ dashboard?.metrics.pendingOutboxEvents ?? 0 }} pending</strong>
              </div>
              <div class="signal-row">
                <span><ShieldCheck :size="17" /> Risk rules</span>
                <strong>{{ dashboard?.metrics.riskRules ?? 0 }} active</strong>
              </div>
              <div class="signal-row">
                <span><Activity :size="17" /> Ledger</span>
                <strong>{{ dashboard?.metrics.ledgerEntries ?? 0 }} entries</strong>
              </div>
            </article>
          </section>
        </template>

        <template v-else-if="activeView === 'payouts'">
          <section class="page-section">
            <header class="page-section-header">
              <div>
                <p>Money movement</p>
                <h2>Payouts</h2>
                <span>Monitor provider dispatch, settlement, and failures.</span>
              </div>
              <button class="primary-button" type="button" @click="openAction('payout')">
                <Plus :size="17" /> Create payout
              </button>
            </header>

            <article class="surface">
              <div class="table-toolbar">
                <div class="toolbar-summary">
                  <span>{{ filteredPayouts.length }} payouts</span>
                  <i />
                  <span>{{ formatMinor(payoutVolume, "USD") }} total volume</span>
                </div>
                <button class="icon-button" type="button" title="Filter payouts">
                  <SlidersHorizontal :size="17" />
                </button>
              </div>
              <div class="table-wrap">
                <table class="data-table roomy">
                  <thead>
                    <tr>
                      <th>Payout</th>
                      <th>Destination</th>
                      <th>Provider</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="payout in filteredPayouts" :key="payout.id">
                      <td>
                        <strong>{{ payout.reference ?? "Unreferenced payout" }}</strong>
                        <span>{{ payout.id }}</span>
                      </td>
                      <td>
                        <span class="mono">{{ payout.destinationAccount }}</span>
                      </td>
                      <td>
                        <span class="mono">{{
                          payout.providerPayoutId ?? "Awaiting dispatch"
                        }}</span>
                      </td>
                      <td>
                        <strong>{{ formatMinor(payout.amountMinor, payout.currency) }}</strong>
                      </td>
                      <td>
                        <span class="status-badge" :class="statusClass(payout.status)">
                          <i />{{ payout.status.replaceAll("_", " ") }}
                        </span>
                      </td>
                      <td>{{ formatDate(payout.createdAt) }}</td>
                    </tr>
                  </tbody>
                </table>
                <div v-if="filteredPayouts.length === 0" class="empty-state">
                  <Search :size="22" />
                  <strong>No matching payouts</strong>
                  <span>Adjust your search or create a payout.</span>
                </div>
              </div>
            </article>
          </section>
        </template>

        <template v-else-if="activeView === 'approvals'">
          <section class="page-section">
            <header class="page-section-header">
              <div>
                <p>Risk operations</p>
                <h2>Approval queue</h2>
                <span>Review payouts held by active risk rules.</span>
              </div>
              <span class="queue-summary">
                <Clock3 :size="16" />
                {{ dashboard?.metrics.pendingApprovals ?? 0 }} pending
              </span>
            </header>

            <article class="surface approval-list">
              <div v-for="approval in dashboard?.approvals" :key="approval.id" class="approval-row">
                <div class="approval-amount">
                  <span class="attention-icon amber"><ShieldCheck :size="18" /></span>
                  <div>
                    <strong>{{ formatMinor(approval.amountMinor, approval.currency) }}</strong>
                    <span>{{ approval.payoutId }}</span>
                  </div>
                </div>
                <div class="approval-detail">
                  <span>Destination</span>
                  <strong class="mono">{{ approval.destinationAccount }}</strong>
                </div>
                <div class="approval-detail reason">
                  <span>Risk signal</span>
                  <strong>{{ approval.riskReason }}</strong>
                </div>
                <span class="status-badge" :class="statusClass(approval.status)">
                  <i />{{ approval.status }}
                </span>
                <div class="approval-actions">
                  <button
                    v-if="approval.status === 'pending'"
                    class="secondary-button success-action"
                    type="button"
                    :disabled="saving"
                    @click="approvePayout(approval.payoutId)"
                  >
                    <Check :size="16" /> Approve
                  </button>
                  <button
                    v-if="approval.status === 'pending'"
                    class="secondary-button danger-action"
                    type="button"
                    :disabled="saving"
                    @click="rejectPayout(approval.payoutId)"
                  >
                    <X :size="16" /> Reject
                  </button>
                </div>
              </div>
              <div v-if="!dashboard?.approvals.length" class="empty-state generous">
                <CheckCircle2 :size="26" />
                <strong>No payouts need review</strong>
                <span>The approval queue is clear.</span>
              </div>
            </article>

            <article class="surface compact-surface">
              <header class="section-header">
                <div>
                  <p>Policy controls</p>
                  <h2>Active risk rules</h2>
                </div>
                <span class="count-badge">{{ dashboard?.riskRules.length ?? 0 }}</span>
              </header>
              <div class="resource-list">
                <div v-for="rule in dashboard?.riskRules" :key="rule.id" class="resource-row">
                  <span class="resource-icon"><SlidersHorizontal :size="17" /></span>
                  <div>
                    <strong>{{ rule.name }}</strong>
                    <span v-if="rule.amountMinor">
                      {{ formatMinor(rule.amountMinor, rule.currency ?? "USD") }} threshold
                    </span>
                    <span v-else>{{ rule.destinationAccount ?? rule.type }}</span>
                  </div>
                  <span class="status-badge" :class="statusClass(rule.status)">
                    <i />{{ rule.status }}
                  </span>
                </div>
              </div>
            </article>
          </section>
        </template>

        <template v-else-if="activeView === 'developers'">
          <section class="page-section">
            <header class="page-section-header">
              <div>
                <p>Integration access</p>
                <h2>Developers</h2>
                <span>Manage clients, credentials, and tenant membership.</span>
              </div>
              <div class="button-group">
                <button class="secondary-button" type="button" @click="openAction('client')">
                  <Server :size="16" /> API client
                </button>
                <button class="primary-button" type="button" @click="openAction('apiKey')">
                  <KeyRound :size="16" /> Mint key
                </button>
              </div>
            </header>

            <section class="resource-grid">
              <article class="surface">
                <header class="section-header">
                  <div>
                    <p>Applications</p>
                    <h2>API clients</h2>
                  </div>
                  <button
                    class="icon-button"
                    type="button"
                    title="Create API client"
                    @click="openAction('client')"
                  >
                    <Plus :size="17" />
                  </button>
                </header>
                <div class="resource-list">
                  <div
                    v-for="client in dashboard?.apiClients"
                    :key="client.id"
                    class="resource-row"
                  >
                    <span class="resource-icon blue"><Server :size="17" /></span>
                    <div>
                      <strong>{{ client.name }}</strong>
                      <span class="mono">{{ client.id }}</span>
                    </div>
                    <span class="status-badge" :class="statusClass(client.status)">
                      <i />{{ client.status }}
                    </span>
                  </div>
                </div>
              </article>

              <article class="surface">
                <header class="section-header">
                  <div>
                    <p>Credentials</p>
                    <h2>API keys</h2>
                  </div>
                  <button
                    class="icon-button"
                    type="button"
                    title="Mint API key"
                    @click="openAction('apiKey')"
                  >
                    <Plus :size="17" />
                  </button>
                </header>
                <div class="resource-list">
                  <div v-for="apiKey in dashboard?.apiKeys" :key="apiKey.id" class="resource-row">
                    <span class="resource-icon green"><KeyRound :size="17" /></span>
                    <div>
                      <strong>{{ apiKey.name }}</strong>
                      <span class="mono">{{ apiKey.keyPrefix }}...</span>
                      <small>{{ apiKey.permissions.join(" ? ") }}</small>
                    </div>
                    <span class="status-badge status-active"><i /> active</span>
                  </div>
                </div>
              </article>

              <article class="surface">
                <header class="section-header">
                  <div>
                    <p>Tenant access</p>
                    <h2>Members</h2>
                  </div>
                  <button
                    class="icon-button"
                    type="button"
                    title="Create tenant"
                    @click="openAction('tenant')"
                  >
                    <Plus :size="17" />
                  </button>
                </header>
                <div class="resource-list">
                  <div
                    v-for="member in dashboard?.memberships"
                    :key="member.id"
                    class="resource-row"
                  >
                    <span class="resource-icon amber"><Users :size="17" /></span>
                    <div>
                      <strong>{{ member.email }}</strong>
                      <span>{{ member.role.replaceAll("_", " ") }}</span>
                    </div>
                    <span class="status-badge" :class="statusClass(member.status)">
                      <i />{{ member.status }}
                    </span>
                  </div>
                </div>
              </article>
            </section>
          </section>
        </template>

        <template v-else-if="activeView === 'webhooks'">
          <section class="page-section">
            <header class="page-section-header">
              <div>
                <p>Event delivery</p>
                <h2>Webhooks</h2>
                <span>Inspect endpoints, attempts, and replayable failures.</span>
              </div>
              <button class="primary-button" type="button" @click="openAction('webhook')">
                <Plus :size="17" /> Register endpoint
              </button>
            </header>

            <section class="webhook-summary">
              <article>
                <span>Endpoints</span>
                <strong>{{ dashboard?.metrics.webhookEndpoints ?? 0 }}</strong>
              </article>
              <article>
                <span>Deliveries</span>
                <strong>{{ dashboard?.metrics.webhookDeliveries ?? 0 }}</strong>
              </article>
              <article>
                <span>Success rate</span>
                <strong>{{ deliveryRate }}%</strong>
              </article>
              <article :class="{ alert: (dashboard?.metrics.failedWebhookDeliveries ?? 0) > 0 }">
                <span>Failed</span>
                <strong>{{ dashboard?.metrics.failedWebhookDeliveries ?? 0 }}</strong>
              </article>
            </section>

            <article class="surface compact-surface">
              <header class="section-header">
                <div>
                  <p>Configuration</p>
                  <h2>Endpoints</h2>
                </div>
              </header>
              <div class="resource-list horizontal">
                <div
                  v-for="endpoint in dashboard?.webhookEndpoints"
                  :key="endpoint.id"
                  class="resource-row"
                >
                  <span class="resource-icon blue"><Webhook :size="17" /></span>
                  <div>
                    <strong>{{ endpoint.description ?? endpoint.id }}</strong>
                    <span class="mono">{{ endpoint.url }}</span>
                    <small>{{ endpoint.eventSubscriptions.join(" ? ") }}</small>
                  </div>
                  <span class="status-badge" :class="statusClass(endpoint.status)">
                    <i />{{ endpoint.status }}
                  </span>
                </div>
              </div>
            </article>

            <article class="surface">
              <header class="section-header">
                <div>
                  <p>Delivery log</p>
                  <h2>Recent attempts</h2>
                </div>
                <span class="count-badge">{{ filteredDeliveries.length }}</span>
              </header>
              <div class="table-wrap">
                <table class="data-table roomy">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Endpoint</th>
                      <th>Attempts</th>
                      <th>Response</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="delivery in filteredDeliveries" :key="delivery.id">
                      <td>
                        <strong>{{ delivery.eventType }}</strong>
                        <span>{{ delivery.aggregateId }}</span>
                      </td>
                      <td>
                        <span class="mono">{{ delivery.webhookEndpointId }}</span>
                      </td>
                      <td>{{ delivery.attempts }}</td>
                      <td>{{ delivery.lastStatusCode ?? "No response" }}</td>
                      <td>
                        <span class="status-badge" :class="statusClass(delivery.status)">
                          <i />{{ delivery.status.replaceAll("_", " ") }}
                        </span>
                      </td>
                      <td class="align-right">
                        <button
                          v-if="delivery.status === 'failed' || delivery.status === 'dead_letter'"
                          class="icon-button"
                          type="button"
                          title="Replay delivery"
                          :disabled="saving"
                          @click="replayWebhookDelivery(delivery.id)"
                        >
                          <RotateCcw :size="16" />
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div v-if="filteredDeliveries.length === 0" class="empty-state">
                  <Webhook :size="22" />
                  <strong>No webhook deliveries</strong>
                  <span>Matching payout events will appear here.</span>
                </div>
              </div>
            </article>
          </section>
        </template>

        <template v-else-if="activeView === 'reconciliation'">
          <section class="page-section">
            <header class="page-section-header">
              <div>
                <p>Settlement operations</p>
                <h2>Reconciliation</h2>
                <span>Compare provider settlement files with internal payout records.</span>
              </div>
              <button class="primary-button" type="button" @click="openAction('settlement')">
                <FileUp :size="17" /> Import settlement
              </button>
            </header>

            <section class="reconciliation-layout">
              <article class="surface import-list">
                <header class="section-header">
                  <div>
                    <p>Import history</p>
                    <h2>Settlement files</h2>
                  </div>
                  <span class="count-badge">{{ reconciliationImports.length }}</span>
                </header>
                <button
                  v-for="item in reconciliationImports"
                  :key="item.id"
                  class="import-row"
                  :class="{ active: selectedReconciliation?.id === item.id }"
                  type="button"
                  @click="selectReconciliationImport(item.id)"
                >
                  <span class="resource-icon blue"><FileSearch :size="17" /></span>
                  <span>
                    <strong>{{ item.fileName }}</strong>
                    <small>{{ item.providerName }} ? {{ formatDate(item.createdAt) }}</small>
                  </span>
                  <span class="import-counts">
                    <strong>{{ item.matchedCount }}/{{ item.rowCount }}</strong>
                    <small>{{ item.discrepancyCount }} exceptions</small>
                  </span>
                  <ChevronRight :size="16" />
                </button>
                <div v-if="reconciliationImports.length === 0" class="empty-state generous">
                  <FileUp :size="24" />
                  <strong>No settlement imports</strong>
                  <button class="text-button" type="button" @click="openAction('settlement')">
                    Import a CSV
                  </button>
                </div>
              </article>

              <article class="surface reconciliation-detail">
                <header class="section-header">
                  <div>
                    <p>Selected import</p>
                    <h2>{{ selectedReconciliation?.fileName ?? "No file selected" }}</h2>
                  </div>
                  <span
                    v-if="selectedReconciliation"
                    class="status-badge"
                    :class="statusClass(selectedReconciliation.status)"
                  >
                    <i />{{ selectedReconciliation.status }}
                  </span>
                </header>

                <div v-if="selectedReconciliation" class="recon-stats">
                  <div>
                    <span>Rows</span>
                    <strong>{{ selectedReconciliation.rowCount }}</strong>
                  </div>
                  <div>
                    <span>Matched</span>
                    <strong class="positive">{{ selectedReconciliation.matchedCount }}</strong>
                  </div>
                  <div>
                    <span>Discrepancies</span>
                    <strong :class="{ negative: selectedReconciliation.discrepancyCount > 0 }">
                      {{ selectedReconciliation.discrepancyCount }}
                    </strong>
                  </div>
                </div>

                <div v-if="selectedReconciliation?.discrepancies.length" class="exception-list">
                  <div
                    v-for="discrepancy in selectedReconciliation.discrepancies"
                    :key="discrepancy.id"
                    class="exception-row"
                  >
                    <span class="attention-icon red"><AlertCircle :size="17" /></span>
                    <div>
                      <strong>{{ discrepancy.providerPayoutId }}</strong>
                      <span>{{ discrepancy.type.replaceAll("_", " ") }}</span>
                    </div>
                    <div>
                      <span>Expected</span>
                      <strong>
                        {{
                          discrepancy.expectedAmountMinor === null
                            ? "No payout"
                            : formatMinor(
                              discrepancy.expectedAmountMinor,
                              discrepancy.expectedCurrency ?? discrepancy.actualCurrency
                            )
                        }}
                      </strong>
                    </div>
                    <div>
                      <span>Received</span>
                      <strong>
                        {{ formatMinor(discrepancy.actualAmountMinor, discrepancy.actualCurrency) }}
                      </strong>
                    </div>
                    <span class="status-badge" :class="statusClass(discrepancy.status)">
                      <i />{{ discrepancy.status }}
                    </span>
                  </div>
                </div>

                <div v-else-if="selectedReconciliation" class="empty-state generous success-empty">
                  <CheckCircle2 :size="26" />
                  <strong>Settlement reconciled</strong>
                  <span>No discrepancies were found in this import.</span>
                </div>
                <div v-else class="empty-state generous">
                  <FileSearch :size="25" />
                  <strong>Select a settlement file</strong>
                  <span>Import details and discrepancies will appear here.</span>
                </div>
              </article>
            </section>

            <article v-if="selectedReconciliation" class="surface">
              <header class="section-header">
                <div>
                  <p>Provider records</p>
                  <h2>Settlement rows</h2>
                </div>
                <span class="count-badge">{{ selectedReconciliation.rows.length }}</span>
              </header>
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Provider payout</th>
                      <th>Internal payout</th>
                      <th>Amount</th>
                      <th>Provider status</th>
                      <th>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in selectedReconciliation.rows" :key="row.id">
                      <td>
                        <strong class="mono">{{ row.providerPayoutId }}</strong>
                      </td>
                      <td>
                        <span class="mono">{{ row.payoutId ?? "Unmatched" }}</span>
                      </td>
                      <td>{{ formatMinor(row.amountMinor, row.currency) }}</td>
                      <td>{{ row.providerStatus }}</td>
                      <td>
                        <span class="status-badge" :class="statusClass(row.matchStatus)">
                          <i />{{ row.matchStatus.replaceAll("_", " ") }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        </template>

        <template v-else-if="activeView === 'audit'">
          <section class="page-section">
            <header class="page-section-header">
              <div>
                <p>System of record</p>
                <h2>Audit & ledger</h2>
                <span>Trace financial entries, domain events, and operator activity.</span>
              </div>
              <span class="queue-summary">
                <Database :size="16" />
                {{ dashboard?.metrics.ledgerEntries ?? 0 }} ledger entries
              </span>
            </header>

            <div class="segmented-control" aria-label="Audit data view">
              <button
                :class="{ active: auditTab === 'ledger' }"
                type="button"
                @click="auditTab = 'ledger'"
              >
                Ledger
              </button>
              <button
                :class="{ active: auditTab === 'events' }"
                type="button"
                @click="auditTab = 'events'"
              >
                Outbox events
              </button>
              <button
                :class="{ active: auditTab === 'audit' }"
                type="button"
                @click="auditTab = 'audit'"
              >
                Audit trail
              </button>
            </div>

            <article class="surface">
              <div v-if="auditTab === 'ledger'" class="table-wrap">
                <table class="data-table roomy">
                  <thead>
                    <tr>
                      <th>Entry</th>
                      <th>Payout</th>
                      <th>Account</th>
                      <th>Direction</th>
                      <th>Amount</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="entry in dashboard?.ledgerEntries" :key="entry.id">
                      <td>
                        <span class="mono">{{ entry.externalId }}</span>
                      </td>
                      <td>
                        <span class="mono">{{ entry.payoutId }}</span>
                      </td>
                      <td>
                        <strong>{{ entry.account }}</strong>
                      </td>
                      <td>
                        <span class="direction-badge" :class="entry.direction">
                          {{ entry.direction }}
                        </span>
                      </td>
                      <td>
                        <strong>{{ formatMinor(entry.amountMinor, entry.currency) }}</strong>
                      </td>
                      <td>{{ formatDate(entry.createdAt) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-else-if="auditTab === 'events'" class="table-wrap">
                <table class="data-table roomy">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Aggregate</th>
                      <th>Resource</th>
                      <th>Attempts</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="event in dashboard?.outboxEvents" :key="event.id">
                      <td>
                        <strong>{{ event.eventType }}</strong><span>{{ event.id }}</span>
                      </td>
                      <td>{{ event.aggregateType }}</td>
                      <td>
                        <span class="mono">{{ event.aggregateId }}</span>
                      </td>
                      <td>{{ event.attempts }}</td>
                      <td>
                        <span class="status-badge" :class="statusClass(event.status)">
                          <i />{{ event.status.replaceAll("_", " ") }}
                        </span>
                      </td>
                      <td>{{ formatDate(event.createdAt) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-else class="audit-list">
                <div v-for="audit in dashboard?.auditLogs" :key="audit.id" class="audit-row">
                  <span class="audit-line" />
                  <span class="resource-icon"><Activity :size="16" /></span>
                  <div>
                    <strong>{{ audit.action.replaceAll(".", " ") }}</strong>
                    <span>{{ audit.actorId }} ? {{ audit.actorType }}</span>
                  </div>
                  <div>
                    <strong>{{ audit.resourceType }}</strong>
                    <span class="mono">{{ audit.resourceId }}</span>
                  </div>
                  <time>{{ formatDate(audit.createdAt) }}</time>
                </div>
              </div>
            </article>
          </section>
        </template>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="activeAction" class="drawer-layer" role="presentation">
        <button class="drawer-scrim" type="button" aria-label="Close panel" @click="closeAction" />
        <aside
          class="action-drawer"
          role="dialog"
          aria-modal="true"
          :aria-label="actionLabels[activeAction]"
        >
          <header class="drawer-header">
            <div>
              <p>PaymentOps</p>
              <h2>{{ actionLabels[activeAction] }}</h2>
            </div>
            <button class="icon-button" type="button" title="Close" @click="closeAction">
              <X :size="18" />
            </button>
          </header>

          <div class="drawer-body">
            <form
              v-if="activeAction === 'tenant'"
              class="action-form"
              @submit.prevent="submitTenant"
            >
              <label>
                <span>Tenant name</span>
                <input
                  v-model="tenantForm.name"
                  required
                  type="text"
                  placeholder="Acme Marketplaces"
                >
              </label>
              <label>
                <span>Owner email</span>
                <input
                  v-model="tenantForm.ownerEmail"
                  type="email"
                  placeholder="owner@example.com"
                >
              </label>
              <div class="form-context">
                <Users :size="17" />
                <span>The owner membership is created with the tenant.</span>
              </div>
              <button class="primary-button full-button" :disabled="saving" type="submit">
                <Plus :size="17" /> Create tenant
              </button>
            </form>

            <form
              v-else-if="activeAction === 'client'"
              class="action-form"
              @submit.prevent="submitApiClient"
            >
              <label>
                <span>Client name</span>
                <input
                  v-model="clientForm.name"
                  required
                  type="text"
                  placeholder="Checkout service"
                >
              </label>
              <div class="form-context">
                <Server :size="17" />
                <span>Client will belong to {{ dashboard?.tenant.name ?? "the active tenant" }}.</span>
              </div>
              <button
                class="primary-button full-button"
                :disabled="saving || !dashboard"
                type="submit"
              >
                <Plus :size="17" /> Create API client
              </button>
            </form>

            <form
              v-else-if="activeAction === 'apiKey'"
              class="action-form"
              @submit.prevent="submitApiKey"
            >
              <label>
                <span>Key name</span>
                <input
                  v-model="apiKeyForm.name"
                  required
                  type="text"
                  placeholder="Production checkout key"
                >
              </label>
              <label>
                <span>API client</span>
                <select v-model="apiKeyForm.apiClientId" required>
                  <option value="" disabled>Select a client</option>
                  <option
                    v-for="client in dashboard?.apiClients"
                    :key="client.id"
                    :value="client.id"
                  >
                    {{ client.name }}
                  </option>
                </select>
              </label>
              <label>
                <span>Permissions</span>
                <input v-model="apiKeyForm.permissions" required type="text">
              </label>
              <div class="form-context warning">
                <KeyRound :size="17" />
                <span>The secret is shown once after creation.</span>
              </div>
              <button
                class="primary-button full-button"
                :disabled="saving || !dashboard"
                type="submit"
              >
                <KeyRound :size="17" /> Mint API key
              </button>
            </form>

            <form
              v-else-if="activeAction === 'payout'"
              class="action-form"
              @submit.prevent="submitPayout"
            >
              <div class="amount-field">
                <span>{{ payoutForm.currency }}</span>
                <input
                  v-model.number="payoutForm.amountMinor"
                  aria-label="Amount in minor units"
                  required
                  min="1"
                  step="1"
                  type="number"
                >
                <small>minor units</small>
              </div>
              <div class="form-split">
                <label>
                  <span>Currency</span>
                  <select v-model="payoutForm.currency" required>
                    <option>USD</option>
                    <option>CAD</option>
                    <option>EUR</option>
                    <option>GBP</option>
                  </select>
                </label>
                <label>
                  <span>Reference</span>
                  <input v-model="payoutForm.reference" type="text" placeholder="invoice-1042">
                </label>
              </div>
              <label>
                <span>Destination account</span>
                <input v-model="payoutForm.destinationAccount" required type="text">
              </label>
              <label>
                <span>API key secret</span>
                <input
                  v-model="payoutForm.apiKeySecret"
                  required
                  type="password"
                  placeholder="pops_sk_test_..."
                >
              </label>
              <label>
                <span>Idempotency key</span>
                <input v-model="payoutForm.idempotencyKey" required type="text">
              </label>
              <label>
                <span>Description</span>
                <textarea
                  v-model="payoutForm.description"
                  rows="3"
                  placeholder="Optional internal context"
                />
              </label>
              <button
                class="primary-button full-button"
                :disabled="saving || !dashboard"
                type="submit"
              >
                <CircleDollarSign :size="17" /> Submit payout
              </button>
            </form>

            <form
              v-else-if="activeAction === 'webhook'"
              class="action-form"
              @submit.prevent="submitWebhook"
            >
              <label>
                <span>Endpoint URL</span>
                <input
                  v-model="webhookForm.url"
                  required
                  type="url"
                  placeholder="https://example.com/paymentops"
                >
              </label>
              <label>
                <span>Description</span>
                <input
                  v-model="webhookForm.description"
                  type="text"
                  placeholder="Production payout events"
                >
              </label>
              <label>
                <span>Subscribed events</span>
                <textarea v-model="webhookForm.eventSubscriptions" required rows="4" />
              </label>
              <div class="form-context warning">
                <Webhook :size="17" />
                <span>The signing secret is shown once after registration.</span>
              </div>
              <button
                class="primary-button full-button"
                :disabled="saving || !dashboard"
                type="submit"
              >
                <Webhook :size="17" /> Register endpoint
              </button>
            </form>

            <form v-else class="action-form" @submit.prevent="submitReconciliation">
              <label>
                <span>Provider</span>
                <input v-model="reconciliationForm.providerName" required type="text">
              </label>
              <label class="file-drop">
                <FileUp :size="24" />
                <strong>
                  {{ reconciliationForm.fileName || "Choose settlement CSV" }}
                </strong>
                <span>CSV files only</span>
                <input
                  ref="settlementFileInput"
                  accept=".csv,text/csv"
                  type="file"
                  @change="handleSettlementFile"
                >
              </label>
              <button
                class="secondary-button full-button"
                type="button"
                @click="loadSampleSettlement"
              >
                <FileSearch :size="16" /> Use sample settlement
              </button>
              <button
                class="primary-button full-button"
                :disabled="saving || !dashboard || !reconciliationForm.csv"
                type="submit"
              >
                <FileUp :size="17" /> Import and reconcile
              </button>
            </form>
          </div>

          <footer class="drawer-footer">
            <ShieldCheck :size="15" />
            <span>Actions are written to the tenant audit log.</span>
          </footer>
        </aside>
      </div>

      <div v-if="revealedSecret" class="modal-layer" role="presentation">
        <div class="modal-scrim" />
        <section
          class="secret-modal"
          role="dialog"
          aria-modal="true"
          :aria-label="revealedSecret.label"
        >
          <div class="secret-icon"><KeyRound :size="22" /></div>
          <p>One-time secret</p>
          <h2>{{ revealedSecret.label }}</h2>
          <code>{{ revealedSecret.value }}</code>
          <div class="form-context warning">
            <AlertCircle :size="17" />
            <span>This value cannot be retrieved after dismissal.</span>
          </div>
          <div class="modal-actions">
            <button class="secondary-button" type="button" @click="dismissSecret">Dismiss</button>
            <button class="primary-button" type="button" @click="copySecret">
              <Check v-if="copiedSecret" :size="17" />
              <Copy v-else :size="17" />
              {{ copiedSecret ? "Copied" : "Copy secret" }}
            </button>
          </div>
        </section>
      </div>

      <Transition name="toast">
        <div v-if="toastVisible && message" class="toast-notice" role="status">
          <CheckCircle2 :size="18" />
          <span>{{ message }}</span>
          <button
            class="icon-button subtle"
            type="button"
            title="Dismiss"
            @click="toastVisible = false"
          >
            <X :size="15" />
          </button>
        </div>
      </Transition>

      <div v-if="saving" class="saving-indicator" role="status">
        <RefreshCw :size="15" class="spin" />
        Processing
      </div>
    </Teleport>
  </main>
</template>
