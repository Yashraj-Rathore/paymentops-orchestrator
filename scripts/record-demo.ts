import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page, type Route } from "@playwright/test";

const baseUrl = process.env.PAYMENTOPS_WEB_URL ?? "http://127.0.0.1:3001";
const outputDirectory = resolve(process.cwd(), "docs", "videos");
const outputFile = resolve(outputDirectory, "paymentops-dashboard-demo.webm");
const tempDirectory = resolve(process.cwd(), "tmp", "demo-video");
const tenantId = "tenant_northstar_marketplaces";
const reconciliationId = "recon_2026_07_merchant_settlement";
const createdAt = "2026-07-12T13:00:00.000Z";
const updatedAt = "2026-07-12T13:18:00.000Z";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

async function mockApi(page: Page) {
  const dashboard = createDashboard();
  const reconciliation = createReconciliation();
  const reconciliationSummary = {
    id: reconciliation.id,
    tenantId,
    providerName: reconciliation.providerName,
    fileName: reconciliation.fileName,
    status: reconciliation.status,
    rowCount: reconciliation.rowCount,
    matchedCount: reconciliation.matchedCount,
    discrepancyCount: reconciliation.discrepancyCount,
    importedBy: reconciliation.importedBy,
    createdAt: reconciliation.createdAt,
    completedAt: reconciliation.completedAt
  };

  await page.route("**/v1/auth/admin/session", (route) =>
    fulfillJson(route, {
      type: "dev_admin",
      subject: "demo.operator@northstar.example",
      email: "demo.operator@northstar.example",
      roles: ["operations_admin"],
      permissions: ["tenants:manage", "payouts:create", "payouts:read", "webhooks:manage"],
      tenantId: null,
      apiClientId: null,
      apiKeyId: null
    })
  );
  await page.route("**/v1/demo/dashboard", (route) => fulfillJson(route, dashboard));
  await page.route("**/v1/tenants/*/summary", (route) => fulfillJson(route, dashboard));
  await page.route("**/v1/tenants/*/reconciliation/imports", (route) => {
    if (route.request().method() === "GET") return fulfillJson(route, [reconciliationSummary]);
    return fulfillJson(route, reconciliation, 201);
  });
  await page.route("**/v1/tenants/*/reconciliation/imports/*", (route) =>
    fulfillJson(route, reconciliation)
  );
  await page.route("**/v1/tenants/*/payouts", (route) => fulfillJson(route, createPayout(), 201));
  await page.route("**/v1/**", (route) => fulfillJson(route, { ok: true }));
}

async function pause(page: Page, milliseconds = 850) {
  await page.waitForTimeout(milliseconds);
}

async function clickNav(page: Page, label: string) {
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: new RegExp(label) })
    .click();
  await pause(page);
}

async function main() {
  await rm(tempDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(tempDirectory, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: tempDirectory,
      size: { width: 1440, height: 960 }
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror", error.stack ?? error.message));
  page.on("requestfailed", (request) =>
    console.error("requestfailed", request.url(), request.failure()?.errorText)
  );
  await mockApi(page);

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.getByText("API connected").waitFor({ timeout: 60_000 });
    await page.getByRole("heading", { name: "Overview", level: 1 }).waitFor();
    await pause(page, 1_100);

    await page.getByRole("button", { name: "New payout" }).click();
    await page.getByRole("dialog", { name: "Create payout" }).waitFor();
    await page.getByLabel("Reference").fill("seller-batch-1042");
    await page.getByLabel("Description").fill("Same-day payout for approved sellers");
    await pause(page, 1_000);
    await page.getByRole("dialog", { name: "Create payout" }).getByTitle("Close").click();
    await pause(page, 350);

    await clickNav(page, "Payouts");
    await clickNav(page, "Approvals");
    await clickNav(page, "Developers");
    await clickNav(page, "Webhooks");
    await clickNav(page, "Reconciliation");
    await clickNav(page, "Audit");
    await page.getByRole("button", { name: "Outbox events" }).click();
    await pause(page, 900);
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();

    if (!video) throw new Error("Playwright did not produce a video artifact.");
    await copyFile(await video.path(), outputFile);
  }

  console.log(`Demo video written to ${outputFile}`);
}

function createDashboard() {
  return {
    tenant: { id: tenantId, name: "Northstar Marketplaces", status: "active", createdAt },
    memberships: [
      { id: "member_ops_admin", email: "ops.admin@northstar.example", role: "merchant_owner", status: "active", createdAt },
      { id: "member_developer", email: "platform.dev@northstar.example", role: "developer", status: "invited", createdAt: updatedAt }
    ],
    apiClients: [{ id: "client_checkout", name: "Checkout service", status: "active", createdAt }],
    apiKeys: [{ id: "key_checkout_live", name: "Checkout write key", keyPrefix: "pops_sk_live_7KQ9", permissions: ["payouts:create", "payouts:read"], createdAt, expiresAt: null }],
    webhookEndpoints: [{ id: "wh_ops_primary", url: "https://merchant.example.com/paymentops/webhooks", description: "Merchant payout events", eventSubscriptions: ["payout.created.v1", "payout.paid.v1", "payout.failed.v1"], status: "active", createdAt }],
    webhookDeliveries: [
      delivery("delivery_paid_001", "payout.paid.v1", "po_1001", "delivered", 1, null),
      delivery("delivery_failed_retry", "payout.failed.v1", "po_1003", "failed", 3, "Merchant endpoint unavailable")
    ],
    riskRules: [{ id: "risk_high_value_usd", name: "High value USD payout review", type: "amount_threshold", action: "require_approval", status: "active", amountMinor: 100000, currency: "USD", destinationAccount: null, createdAt }],
    approvals: [{ id: "approval_high_value_001", payoutId: "po_1002", tenantId, status: "pending", riskRuleId: "risk_high_value_usd", riskReason: "USD payout exceeds 1000.00 threshold", amountMinor: 125000, currency: "USD", destinationAccount: "acct_demo_merchant_bank", requestedAt: updatedAt, decidedAt: null, decidedBy: null }],
    payouts: [
      payout("po_1001", "prov_po_9001", 87500, "USD", "acct_vendor_alpha", "paid"),
      payout("po_1002", null, 125000, "USD", "acct_demo_merchant_bank", "needs_approval"),
      payout("po_1003", "prov_po_9003", 43250, "CAD", "acct_vendor_beta", "failed")
    ],
    ledgerEntries: [
      ledger("ledger_debit_1001", "le_1001_debit", "po_1001", "debit", "tenant:available", 87500),
      ledger("ledger_credit_1001", "le_1001_credit", "po_1001", "credit", "provider:pending", 87500)
    ],
    outboxEvents: [outbox("outbox_001", "payout.created.v1", "po_1002", "published", 1), outbox("outbox_002", "payout.approval_requested.v1", "po_1002", "pending", 0)],
    auditLogs: [
      audit("audit_tenant_seed", "system", "seed", "tenant.seeded", "tenant", tenantId),
      audit("audit_payout_created", "api_key", "key_checkout_live", "payout.created", "payout", "po_1002"),
      audit("audit_webhook_retry", "worker", "webhook-delivery", "webhook.delivery.failed", "webhook_delivery", "delivery_failed_retry")
    ],
    metrics: { members: 2, apiClients: 1, activeApiKeys: 1, webhookEndpoints: 1, webhookDeliveries: 2, failedWebhookDeliveries: 1, riskRules: 1, pendingApprovals: 1, payouts: 3, ledgerEntries: 2, pendingOutboxEvents: 1, auditEvents: 3 }
  };
}

function payout(id: string, providerPayoutId: string | null, amountMinor: number, currency: string, destinationAccount: string, status: string) {
  return { id, tenantId, providerPayoutId, amountMinor, currency, destinationAccount, reference: id === "po_1002" ? "seller-batch-1042" : "seller-batch-1040", description: id === "po_1002" ? "Same-day payout pending approval" : "Daily seller settlement", status, createdAt, updatedAt };
}

function delivery(id: string, eventType: string, aggregateId: string, status: string, attempts: number, lastError: string | null) {
  return { id, webhookEndpointId: "wh_ops_primary", eventId: "evt_" + id, eventType, aggregateType: "payout", aggregateId, status, attempts, nextAttemptAt: status === "failed" ? "2026-07-12T13:40:00.000Z" : null, lastAttemptedAt: updatedAt, deliveredAt: status === "delivered" ? updatedAt : null, lastStatusCode: status === "delivered" ? 200 : 503, lastError, createdAt: updatedAt };
}

function ledger(id: string, externalId: string, payoutId: string, direction: string, account: string, amountMinor: number) {
  return { id, externalId, payoutId, direction, account, amountMinor, currency: "USD", createdAt };
}

function outbox(id: string, eventType: string, aggregateId: string, status: string, attempts: number) {
  return { id, eventType, aggregateType: "payout", aggregateId, status, attempts, createdAt: updatedAt };
}

function audit(id: string, actorType: string, actorId: string, action: string, resourceType: string, resourceId: string) {
  return { id, actorType, actorId, action, resourceType, resourceId, createdAt: updatedAt };
}

function createReconciliation() {
  return {
    id: reconciliationId,
    tenantId,
    providerName: "PaymentOps Provider Simulator",
    fileName: "demo-settlement.csv",
    status: "completed",
    rowCount: 3,
    matchedCount: 1,
    discrepancyCount: 2,
    importedBy: "demo.operator@northstar.example",
    createdAt: updatedAt,
    completedAt: "2026-07-12T13:24:04.000Z",
    rows: [
      settlementRow("row_matched_001", "prov_po_9001", "po_1001", 87500, "USD", "matched"),
      settlementRow("row_amount_mismatch", "prov_po_9003", "po_1003", 43350, "CAD", "amount_mismatch"),
      settlementRow("row_missing_provider", "provider_missing_demo", null, 1750, "USD", "missing")
    ],
    discrepancies: [
      discrepancy("disc_amount_mismatch", "row_amount_mismatch", "prov_po_9003", "po_1003", "amount_mismatch", 43250, 43350, "CAD"),
      discrepancy("disc_missing_provider", "row_missing_provider", "provider_missing_demo", null, "missing", null, 1750, "USD")
    ]
  };
}

function settlementRow(id: string, providerPayoutId: string, payoutId: string | null, amountMinor: number, currency: string, matchStatus: string) {
  return { id, providerPayoutId, payoutId, amountMinor, currency, providerStatus: "paid", settledAt: updatedAt, matchStatus };
}

function discrepancy(id: string, settlementRowId: string, providerPayoutId: string, payoutId: string | null, type: string, expectedAmountMinor: number | null, actualAmountMinor: number, actualCurrency: string) {
  return { id, settlementRowId, providerPayoutId, payoutId, type, status: "open", expectedAmountMinor, actualAmountMinor, expectedCurrency: expectedAmountMinor ? actualCurrency : null, actualCurrency, resolutionNote: null, resolvedBy: null, createdAt: updatedAt, resolvedAt: null };
}

function createPayout() {
  return { ...payout("po_recorded_demo", null, 125000, "USD", "acct_demo_merchant_bank", "needs_approval"), ledgerEntries: [], statusHistory: [{ id: "history_recorded_demo", fromStatus: null, toStatus: "needs_approval", reason: "High value USD payout review", createdAt: updatedAt }], outboxEvents: [], idempotencyKey: "demo-idempotency-key", replayed: false };
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});