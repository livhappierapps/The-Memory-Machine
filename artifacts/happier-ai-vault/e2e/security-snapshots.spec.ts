import { test, expect } from "@playwright/test";
import { setupClerkTestingToken, clerk } from "@clerk/testing/playwright";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_USER_FILE = join(__dirname, "..", "test-results", "test-user.json");

function getTestUser(): { emailAddress: string } {
  return JSON.parse(readFileSync(TEST_USER_FILE, "utf-8"));
}

test.describe("Security — Data Snapshots", () => {
  test.beforeEach(async ({ context }) => {
    await setupClerkTestingToken({ context });
  });

  test("create a snapshot and verify it appears in the list", async ({ page }) => {
    const { emailAddress } = getTestUser();

    await page.goto("/");

    await clerk.signIn({ page, emailAddress });

    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible({ timeout: 15_000 });

    const snapshotsSection = page
      .getByText("Data Snapshots")
      .locator("..")
      .locator("..");
    await snapshotsSection.scrollIntoViewIfNeeded();

    const createBtn = page.getByRole("button", { name: /create snapshot/i });
    await expect(createBtn).toBeVisible();

    await createBtn.click();

    await expect(page.getByText(/snapshot created/i)).toBeVisible({ timeout: 20_000 });

    const snapshotCard = page.locator(".rounded-lg.border").filter({
      has: page.getByText(/manual snapshot/i),
    });
    await expect(snapshotCard).toBeVisible({ timeout: 10_000 });

    await expect(snapshotCard).toContainText(/KB|MB|B/);

    const restoreBtn = snapshotCard.locator('[title="Restore snapshot"]');
    const deleteBtn = snapshotCard.locator('[title="Delete snapshot"]');
    await expect(restoreBtn).toBeVisible();
    await expect(deleteBtn).toBeVisible();
  });

  test("created snapshot persists on page reload", async ({ page }) => {
    const { emailAddress } = getTestUser();

    await page.goto("/");
    await clerk.signIn({ page, emailAddress });
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole("button", { name: /create snapshot/i });
    await expect(createBtn).toBeVisible();
    await createBtn.click();
    await expect(page.getByText(/snapshot created/i).first()).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible({ timeout: 15_000 });

    const snapshotCard = page.locator(".rounded-lg.border").filter({
      has: page.getByText(/manual snapshot/i),
    }).first();
    await expect(snapshotCard).toBeVisible({ timeout: 10_000 });
  });
});
