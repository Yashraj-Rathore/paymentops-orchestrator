import { expect, test } from "@playwright/test";

test("operator can navigate the seeded operations dashboard", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "Desktop navigation check");

  await page.goto("/");

  await expect(page.getByText("API connected")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.getByRole("button", { name: "Payouts" }).click();
  await expect(page.getByRole("heading", { name: "Payouts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New payout" })).toBeVisible();

  await page.getByRole("button", { name: "Reconciliation" }).click();
  await expect(page.getByRole("heading", { name: "Reconciliation" })).toBeVisible();
});

test("mobile navigation remains usable", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only navigation check");

  await page.goto("/");
  await expect(page.getByText("API connected")).toBeVisible({ timeout: 60_000 });
  await page.getByTitle("Open navigation").click();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Webhooks" }).click();
  await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();
});
