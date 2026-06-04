import { createClerkClient } from "@clerk/backend";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_USER_FILE = join(__dirname, "..", "test-results", "test-user.json");

export default async function globalTeardown() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return;

  if (!existsSync(TEST_USER_FILE)) return;

  const { userId } = JSON.parse(readFileSync(TEST_USER_FILE, "utf-8"));
  if (!userId) return;

  const clerk = createClerkClient({ secretKey });
  try {
    await clerk.users.deleteUser(userId);
    console.log(`[global-teardown] Test user deleted: ${userId}`);
  } catch (err) {
    console.warn("[global-teardown] Could not delete test user:", err);
  }
}
