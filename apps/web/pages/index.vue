<script setup lang="ts">
import { paymentOpsPalette } from "@paymentops/ui";
import { useFoundationStore } from "~/stores/foundation";

const store = useFoundationStore();

const lanes = [
  { label: "Payout intake", value: "Idempotency shell", state: "Ready" },
  { label: "Provider simulator", value: "Callback contract", state: "Ready" },
  { label: "Webhook delivery", value: "Retry queue pending", state: "Planned" },
  { label: "Reconciliation", value: "CSV workflow pending", state: "Planned" }
];
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
        <a class="nav-item" href="#">Payouts</a>
        <a class="nav-item" href="#">Approvals</a>
        <a class="nav-item" href="#">Webhooks</a>
        <a class="nav-item" href="#">Reconciliation</a>
      </nav>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">Foundation milestone</p>
          <h1>Operations Command Center</h1>
        </div>
        <button class="icon-button" type="button" title="Refresh health status" @click="store.refresh">
          <span aria-hidden="true">↻</span>
        </button>
      </header>

      <section class="status-grid" aria-label="Foundation status">
        <article class="metric">
          <span>API</span>
          <strong>{{ store.apiStatus }}</strong>
          <small>Health endpoint wired</small>
        </article>
        <article class="metric">
          <span>Auth</span>
          <strong>Auth0</strong>
          <small>ADR and env ready</small>
        </article>
        <article class="metric">
          <span>Events</span>
          <strong>Redpanda</strong>
          <small>Topics package seeded</small>
        </article>
        <article class="metric">
          <span>Source</span>
          <strong>SQL Server</strong>
          <small>Compose service defined</small>
        </article>
      </section>

      <section class="lanes" aria-label="Workflow lanes">
        <article v-for="lane in lanes" :key="lane.label" class="lane">
          <div>
            <span class="lane-state" :style="{ color: paymentOpsPalette.action }">{{ lane.state }}</span>
            <h2>{{ lane.label }}</h2>
          </div>
          <p>{{ lane.value }}</p>
        </article>
      </section>
    </section>
  </main>
</template>
