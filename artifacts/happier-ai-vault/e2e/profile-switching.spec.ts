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

/** Navigate to /vault and wait for the profiles API to confirm the user exists. */
async function goToVault(page: import("@playwright/test").Page) {
  await page.goto("/vault");
  await page.waitForResponse(
    (r) => r.url().includes("/api/profiles") && r.status() === 200,
    { timeout: 30_000 },
  );
}

/** Open the profile switcher dropdown. */
async function openProfileDropdown(page: import("@playwright/test").Page) {
  const trigger = page.getByTestId("profile-switcher-trigger");
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await trigger.click();
  await expect(page.getByRole("menu")).toBeVisible({ timeout: 5_000 });
}

/**
 * Creates a new profile through the UI dialog and waits for the 201 API response.
 * Thanks to the ProfileContext pendingProfileIdRef fix, the new profile becomes
 * the active profile as soon as creation succeeds — no separate switch needed.
 * Returns the numeric profile id.
 */
async function createProfileViaUI(
  page: import("@playwright/test").Page,
  name: string,
): Promise<number> {
  await openProfileDropdown(page);

  const newProfileItem = page.getByRole("menuitem", { name: /new profile/i });
  await expect(newProfileItem).toBeVisible({ timeout: 5_000 });
  await newProfileItem.click();

  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("heading", { name: /new profile/i })).toBeVisible();

  await page.getByPlaceholder(/beloved leo/i).fill(name);

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/profiles") && r.request().method() === "POST",
      { timeout: 20_000 },
    ),
    page.getByRole("button", { name: /create profile/i }).click(),
  ]);

  expect(response.status()).toBe(201);
  const created = await response.json() as { id: number };

  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });
  // Toast — first() because an aria-live region also contains the text
  await expect(page.getByText(/profile created/i).first()).toBeVisible({ timeout: 10_000 });

  return created.id;
}

/**
 * Switch to a profile by ID using the data-profile-id attribute on dropdown items.
 * Using ID avoids false failures when the user has multiple profiles with the same name
 * (e.g. two "Default" profiles accumulated across test runs).
 * Asserts the switcher trigger reflects the expected display name afterwards.
 */
async function switchToProfileById(
  page: import("@playwright/test").Page,
  profileId: number,
  expectedName: string,
) {
  await openProfileDropdown(page);

  const item = page.locator(`[role="menuitem"][data-profile-id="${profileId}"]`);
  await expect(item).toBeVisible({ timeout: 5_000 });
  await item.click();

  // Wait for the dropdown to close
  await expect(page.getByRole("menu")).not.toBeVisible({ timeout: 5_000 });

  // The trigger must reflect the newly selected profile
  const trigger = page.getByTestId("profile-switcher-trigger");
  await expect(trigger).toContainText(expectedName, { timeout: 10_000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Profile switching and thread scoping", () => {
  test.beforeEach(async ({ context }) => {
    await setupClerkTestingToken({ context });
  });

  // ── Test 1: Create a second profile ────────────────────────────────────────
  test("create a second profile via the profile dialog", async ({ page }) => {
    const { emailAddress } = getTestUser();
    await page.goto("/");
    await clerk.signIn({ page, emailAddress });
    await goToVault(page);

    const profileName = `E2E Profile ${Date.now()}`;
    const profileId = await createProfileViaUI(page, profileName);

    // Verify the new profile appears in the dropdown list by its unique ID
    await openProfileDropdown(page);
    await expect(
      page.locator(`[role="menuitem"][data-profile-id="${profileId}"]`),
    ).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
  });

  // ── Test 2: Switch profiles — thread list is profile-scoped ────────────────
  test("switch between profiles — thread list updates to show only that profile's threads", async ({ page }) => {
    const { emailAddress } = getTestUser();
    await page.goto("/");
    await clerk.signIn({ page, emailAddress });
    await goToVault(page);

    // Identify the first (Default) profile for this user
    const profilesResp = await page.request.get("/api/profiles");
    const profilesList = await profilesResp.json() as Array<{ id: number; name: string }>;
    const defaultProfile = profilesList[0];

    // Wait for the Default profile to become active (ProfileContext fallback fires)
    const trigger = page.getByTestId("profile-switcher-trigger");
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    // Ensure the active profile matches Default's ID by confirming its name is shown
    await expect(
      page.locator(`[data-testid="profile-switcher-trigger"]`),
    ).toContainText(defaultProfile.name, { timeout: 10_000 });

    // Create a thread under the Default profile via the "New Memory" button
    const newMemoryBtn = page.getByRole("button", { name: /new memory/i });
    await expect(newMemoryBtn).toBeVisible({ timeout: 15_000 });
    await expect(newMemoryBtn).toBeEnabled({ timeout: 10_000 });

    const [createResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/threads") && r.request().method() === "POST",
        { timeout: 15_000 },
      ),
      newMemoryBtn.click(),
    ]);
    expect(createResp.status()).toBe(201);
    const createdThread = await createResp.json() as { id: number; title: string };

    // "New Conversation" appears in the sidebar under Default
    await expect(page.getByText("New Conversation").first()).toBeVisible({ timeout: 15_000 });

    // ── Create Profile B — it becomes the active profile automatically ──────
    const profileBName = `E2E Profile B ${Date.now()}`;
    const profileBId = await createProfileViaUI(page, profileBName);

    // Profile B is now active (switcher shows its name)
    await expect(trigger).toContainText(profileBName, { timeout: 10_000 });

    // Profile B is brand new — the Default thread must NOT appear
    await expect(page.getByText("New Conversation")).not.toBeVisible({ timeout: 5_000 });

    // ── Switch back to Default via the dropdown (the real UX switch path) ───
    // Register the waitForResponse BEFORE the switch fires so the listener is
    // in place before the GET /api/threads request is sent.
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/threads") && r.request().method() === "GET",
        { timeout: 15_000 },
      ),
      switchToProfileById(page, defaultProfile.id, defaultProfile.name),
    ]);

    // The thread created under Default must be visible again
    await expect(page.getByText("New Conversation").first()).toBeVisible({ timeout: 10_000 });

    // Cleanup: use profileBId to suppress TS "unused" warning
    void profileBId;
  });

  // ── Test 3: New Memory button creates a thread under the active profile ─────
  test("New Memory button creates a thread under the active profile", async ({ page }) => {
    const { emailAddress } = getTestUser();
    await page.goto("/");
    await clerk.signIn({ page, emailAddress });
    await goToVault(page);

    // Create an isolated profile — it becomes active automatically
    const isolatedName = `E2E Isolated ${Date.now()}`;
    const isolatedId = await createProfileViaUI(page, isolatedName);

    // Confirm the isolated profile is active in the switcher
    const trigger = page.getByTestId("profile-switcher-trigger");
    await expect(trigger).toContainText(isolatedName, { timeout: 10_000 });

    // New Memory button must be visible and enabled
    const newMemoryBtn = page.getByRole("button", { name: /new memory/i });
    await expect(newMemoryBtn).toBeVisible({ timeout: 10_000 });
    await expect(newMemoryBtn).toBeEnabled({ timeout: 5_000 });

    // Click and capture the created thread from the API response
    const [createResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/threads") && r.request().method() === "POST",
        { timeout: 15_000 },
      ),
      newMemoryBtn.click(),
    ]);

    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as { id: number; profileId: number; title: string };
    expect(created.title).toBe("New Conversation");

    // Thread must appear in the sidebar
    await expect(page.getByText("New Conversation").first()).toBeVisible({ timeout: 15_000 });

    // The thread must be scoped to the isolated profile
    expect(created.profileId).toBe(isolatedId);
  });

  // ── Test 4: Profile-scoped thread count is correct after creation ───────────
  test("profile-scoped thread count is correct after thread creation", async ({ page }) => {
    const { emailAddress } = getTestUser();
    await page.goto("/");
    await clerk.signIn({ page, emailAddress });
    await goToVault(page);

    // Create a scoped profile — it becomes active automatically
    const scopedName = `E2E Scoped ${Date.now()}`;
    const scopedId = await createProfileViaUI(page, scopedName);

    // Confirm the scoped profile is active
    const trigger = page.getByTestId("profile-switcher-trigger");
    await expect(trigger).toContainText(scopedName, { timeout: 10_000 });

    // Read the initial thread count for this profile directly from the API
    const beforeResp = await page.request.get(`/api/threads?source=chat&profileId=${scopedId}`);
    expect(beforeResp.ok()).toBeTruthy();
    const threadsBefore = await beforeResp.json() as unknown[];
    const countBefore = Array.isArray(threadsBefore) ? threadsBefore.length : 0;

    // Create one thread
    const newMemoryBtn = page.getByRole("button", { name: /new memory/i });
    await expect(newMemoryBtn).toBeEnabled({ timeout: 10_000 });

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/threads") && r.request().method() === "POST",
        { timeout: 15_000 },
      ),
      newMemoryBtn.click(),
    ]);

    // Wait for the sidebar refetch (GET /api/threads fires after the POST)
    await page.waitForResponse(
      (r) => r.url().includes("/api/threads") && r.request().method() === "GET",
      { timeout: 15_000 },
    );

    // Re-query the API directly for an authoritative count
    const afterResp = await page.request.get(`/api/threads?source=chat&profileId=${scopedId}`);
    expect(afterResp.ok()).toBeTruthy();
    const threadsAfter = await afterResp.json() as unknown[];
    const countAfter = Array.isArray(threadsAfter) ? threadsAfter.length : 0;

    // Exactly one thread was created — count must be +1
    expect(countAfter).toBe(countBefore + 1);
  });
});
