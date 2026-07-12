import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

interface DashboardResponse {
  tenant: { id: string; name: string };
  apiClients: Array<{ id: string; name: string; status: string }>;
}

interface ApiKeyResponse {
  id: string;
  name: string;
  secret: string;
}

const webBaseUrl = process.env.PAYMENTOPS_WEB_URL ?? "http://localhost:3001";
const apiBaseUrl = process.env.PAYMENTOPS_API_URL ?? "http://localhost:3000";
const providerBaseUrl = process.env.PAYMENTOPS_PROVIDER_URL ?? "http://localhost:3003";
const devAdminToken = process.env.PAYMENTOPS_DEV_ADMIN_TOKEN ?? "dev-admin-token";
const outputDirectory = resolve(process.cwd(), "docs", "videos");
const outputFile = resolve(outputDirectory, "paymentops-dashboard-demo.webm");
const tempDirectory = resolve(process.cwd(), "tmp", "demo-video");
const introHoldMs = 2_600;
const sectionHoldMs = 3_200;
const actionHoldMs = 1_400;
const finalHoldMs = 4_000;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${url} failed with ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
}

async function waitForEndpoint(url: string, label: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await requestJson<unknown>(url);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
    }
  }
  throw new Error(`${label} did not become healthy: ${String(lastError)}`);
}

async function prepareLiveDemo() {
  await waitForEndpoint(`${apiBaseUrl}/health`, "API");
  await waitForEndpoint(`${providerBaseUrl}/health`, "provider simulator");

  const headers = {
    "content-type": "application/json",
    "x-paymentops-dev-admin-token": devAdminToken
  };
  const dashboard = await requestJson<DashboardResponse>(`${apiBaseUrl}/v1/demo/seed`, {
    method: "POST",
    headers,
    body: "{}"
  });
  const client = dashboard.apiClients.find((candidate) => candidate.status === "active");

  if (!client) {
    throw new Error(`Tenant ${dashboard.tenant.id} has no active API client for the demo.`);
  }

  const suffix = Date.now().toString(36);
  const apiKey = await requestJson<ApiKeyResponse>(
    `${apiBaseUrl}/v1/tenants/${dashboard.tenant.id}/api-keys`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: `Recorded demo key ${suffix}`,
        apiClientId: client.id,
        permissions: ["payouts:create", "payouts:read", "webhooks:manage"]
      })
    }
  );

  return {
    tenantId: dashboard.tenant.id,
    tenantName: dashboard.tenant.name,
    apiKeySecret: apiKey.secret,
    payoutReference: `recorded-live-${suffix}`,
    idempotencyKey: `idem_recorded_${suffix}`
  };
}

async function pause(page: Page, milliseconds = sectionHoldMs) {
  await page.waitForTimeout(milliseconds);
}

async function clickNav(page: Page, label: string) {
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: new RegExp(label) })
    .click();
  await pause(page);
}

async function previewScroll(page: Page) {
  await page.mouse.wheel(0, 520);
  await pause(page, 1_500);
  await page.mouse.wheel(0, -520);
  await pause(page, 1_200);
}

async function recordLiveDemo() {
  const demo = await prepareLiveDemo();

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

  try {
    await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
    await page.getByText("API connected").waitFor({ timeout: 60_000 });
    await page.getByRole("heading", { name: "Overview", level: 1 }).waitFor();
    await page.getByText(demo.tenantName).first().waitFor({ timeout: 30_000 });
    await pause(page, introHoldMs);
    await previewScroll(page);

    await page.getByRole("button", { name: "New payout" }).click();
    const payoutDialog = page.getByRole("dialog", { name: "Create payout" });
    await payoutDialog.waitFor();
    await pause(page, actionHoldMs);
    await page.getByLabel("Amount in minor units").fill("125000");
    await page.getByLabel("Reference").fill(demo.payoutReference);
    await pause(page, 700);
    await page.getByLabel("Destination account").fill("acct_live_demo_merchant_bank");
    await page.getByLabel("API key secret").fill(demo.apiKeySecret);
    await page.getByLabel("Idempotency key").fill(demo.idempotencyKey);
    await pause(page, 700);
    await page.getByLabel("Description").fill("Live Docker Compose demo payout using the real API");
    await pause(page, actionHoldMs);
    await page.getByRole("button", { name: "Submit payout" }).click();
    await page.getByText("Created payout").waitFor({ timeout: 45_000 });
    await pause(page, 2_800);

    await clickNav(page, "Payouts");
    await page.getByText(demo.payoutReference).waitFor({ timeout: 30_000 });
    await pause(page, sectionHoldMs);
    await clickNav(page, "Approvals");
    await page.getByText("acct_live_demo_merchant_bank").first().waitFor({ timeout: 30_000 });
    await pause(page, sectionHoldMs);
    await clickNav(page, "Developers");
    await clickNav(page, "Webhooks");
    await clickNav(page, "Reconciliation");
    await clickNav(page, "Audit");
    await page.getByRole("button", { name: "Outbox events" }).click();
    await pause(page, sectionHoldMs);
    await page.getByRole("button", { name: "Audit trail" }).click();
    await pause(page, finalHoldMs);
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();

    if (!video) throw new Error("Playwright did not produce a video artifact.");
    await copyFile(await video.path(), outputFile);
  }

  console.log(`Recorded live full-stack demo for ${demo.tenantId}.`);
  console.log(`Demo video written to ${outputFile}`);
}

recordLiveDemo().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
