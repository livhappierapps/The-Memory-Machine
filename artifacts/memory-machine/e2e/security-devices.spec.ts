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

test.describe("Security — Trusted Devices (OTP flow)", () => {
  test.beforeEach(async ({ context }) => {
    await setupClerkTestingToken({ context });
  });

  test("trust a device via OTP and then revoke it", async ({ page }) => {
    const { emailAddress } = getTestUser();

    await page.goto("/");
    await clerk.signIn({ page, emailAddress });
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible({ timeout: 15_000 });

    const trustedDevicesHeading = page.getByRole("heading", { name: "Trusted Devices" });
    await trustedDevicesHeading.scrollIntoViewIfNeeded();

    const trustBtn = page.getByRole("button", { name: /trust this device/i });
    await expect(trustBtn).toBeVisible();
    await trustBtn.click();

    const labelInput = page.getByPlaceholder(/macbook|iphone|work pc/i);
    await expect(labelInput).toBeVisible();
    await labelInput.fill("E2E Test Browser");

    const sendCodeBtn = page.getByRole("button", { name: /send code/i });
    await sendCodeBtn.click();

    const otpAmberBox = page.locator(".text-amber-200").filter({
      hasText: /no email configured/i,
    });
    await expect(otpAmberBox).toBeVisible({ timeout: 10_000 });

    const otpCode = await otpAmberBox.locator("strong").textContent();
    expect(otpCode).toMatch(/^\d{6}$/);

    const otpInput = page.getByPlaceholder(/6-digit code/i);
    await expect(otpInput).toBeVisible();
    await otpInput.fill(otpCode!);

    const verifyBtn = page.getByRole("button", { name: /verify/i });
    await expect(verifyBtn).toBeEnabled();
    await verifyBtn.click();

    await expect(page.getByText(/device trusted/i)).toBeVisible({ timeout: 10_000 });

    const deviceCard = page.locator(".rounded-lg.border").filter({
      has: page.getByText("E2E Test Browser"),
    });
    await expect(deviceCard).toBeVisible({ timeout: 5_000 });
    await expect(deviceCard).toContainText(/last seen|expires/i);

    const revokeBtn = deviceCard.locator('[title="Revoke device"]');
    await expect(revokeBtn).toBeVisible();
    await revokeBtn.click();

    await expect(page.getByText(/device revoked/i)).toBeVisible({ timeout: 5_000 });

    await expect(deviceCard).not.toBeVisible({ timeout: 5_000 });

    await expect(page.getByRole("button", { name: /trust this device/i })).toBeVisible();
  });
});
