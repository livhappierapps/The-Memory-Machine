import { clerkSetup } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_USER_FILE = join(__dirname, "..", "test-results", "test-user.json");

export default async function globalSetup() {
  await clerkSetup();

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY env var is required to create test users");
  }

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

  console.log(`[global-setup] Test user created: ${emailAddress} (${user.id})`);
}
