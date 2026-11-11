import { clerkSetup } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_USER_FILE = join(__dirname, "..", "test-results", "test-user.json");

export default async function globalSetup() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey?.startsWith("sk_test_")) {
    throw new Error("Browser fixtures require a Clerk development key; refusing to create test users in production.");
  }
  await clerkSetup();

  const clerk = createClerkClient({ secretKey });

  const suffix = Date.now();
  const emailAddress = `security.e2e+${suffix}@example.com`;
  const firstName = "SecurityE2E";
  const lastName = "Tester";

  const user = await clerk.users.createUser({
    emailAddress: [emailAddress],
    firstName,
    lastName,
    password: `TestPass-${suffix}!`,
    skipPasswordChecks: true,
  });

  mkdirSync(join(__dirname, "..", "test-results"), { recursive: true });
  writeFileSync(
    TEST_USER_FILE,
    JSON.stringify({ userId: user.id, emailAddress, firstName, lastName }),
    "utf-8",
  );

  console.log("[global-setup] Test user created");
}
