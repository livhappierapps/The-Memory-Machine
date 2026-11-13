import { test, expect } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const callback = "https://grok.com/connectors-oauth-exchange-code/";
const consentPath = `/oauth/authorize?${new URLSearchParams({
  client_id: "https://grok.com/oauth/mcp-client.json",
  redirect_uri: callback,
  code_challenge: createHash("sha256").update("fixture-verifier".repeat(4)).digest("base64url"),
  code_challenge_method: "S256",
  state: "browser-consent-fixture",
})}`;

test.beforeEach(async ({ context }) => { await setupClerkTestingToken({ context }); });

test("signed-out connector consent preserves its return URL when opening sign-in", async ({ page }) => {
  await page.goto(consentPath);
  const link = page.getByRole("link", { name: "Sign in to Memory Machine", exact: true });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  const target = new URL(href!, page.url());
  expect(target.pathname).toBe("/sign-in");
  const returnTo = new URL(target.searchParams.get("redirect_url")!);
  expect(returnTo.pathname).toBe("/oauth/authorize");
  expect(returnTo.searchParams.get("state")).toBe("browser-consent-fixture");
  await link.click();
  await expect(page.locator(".cl-signIn-root")).toBeVisible({ timeout: 20_000 });
});

test("real signed-in browser cookies approve Grok consent without an unauthorized error", async ({ page }) => {
  const fixture = JSON.parse(readFileSync(
    fileURLToPath(new URL("../test-results/test-user.json", import.meta.url)), "utf8",
  ));
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(error.message); });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: fixture.emailAddress });
  let callbackUrl = "";
  // Do not contact Grok or expose a live authorization code in test output.
  await page.route(`${callback}**`, async (route) => {
    callbackUrl = route.request().url();
    await route.fulfill({ contentType: "text/plain", body: "Connector callback reached." });
  });
  await page.goto(consentPath);
  const approve = page.getByRole("button", { name: "Allow", exact: true });
  await expect(approve).toBeEnabled({ timeout: 20_000 });
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/oauth/code") && r.request().method() === "POST"),
    approve.click(),
  ]);
  expect(response.status()).toBe(200);
  await expect.poll(() => Boolean(callbackUrl)).toBe(true);
  const returned = new URL(callbackUrl);
  expect(Boolean(returned.searchParams.get("code"))).toBe(true);
  expect(returned.searchParams.get("state")).toBe("browser-consent-fixture");
  expect(errors).toEqual([]);
});
