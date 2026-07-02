import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

const baseUrl = process.env.PAYMENTOPS_WEB_URL ?? "http://127.0.0.1:3001";
const outputDirectory = resolve(process.cwd(), "docs", "images");

async function waitForDashboard(page: Page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByText("API connected").waitFor({ timeout: 60_000 });
  await page.getByRole("heading", { name: "Overview", level: 1 }).waitFor();
}

async function captureDesktop(browser: Browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1
  });

  await waitForDashboard(page);
  await page.screenshot({
    path: resolve(outputDirectory, "dashboard-overview.png"),
    fullPage: true
  });

  await page.getByRole("button", { name: "New payout" }).click();
  await page.getByRole("dialog", { name: "Create payout" }).waitFor();
  await page.screenshot({
    path: resolve(outputDirectory, "create-payout.png"),
    fullPage: false
  });

  await page.close();
}

async function captureMobile(browser: Browser) {
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 1
  });

  await waitForDashboard(page);
  await page.getByTitle("Open navigation").click();
  await page.locator(".app-sidebar.is-open").waitFor();
  await page.getByRole("navigation", { name: "Primary navigation" }).waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({
    path: resolve(outputDirectory, "dashboard-mobile.png"),
    fullPage: false
  });

  await page.close();
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });

  const browser = await chromium.launch();

  try {
    await captureDesktop(browser);
    await captureMobile(browser);
  } finally {
    await browser.close();
  }

  console.log(`README screenshots written to ${outputDirectory}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
