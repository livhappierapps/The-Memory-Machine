import { pool } from "@workspace/db";
import { ensureVectorSchema } from "../lib/db-bootstrap.js";

/**
 * The API build runs tests before server startup. Provision only the vector
 * schema required by integration tests; do not run the startup embedding sweep.
 */
export default async function setupTestDatabase(): Promise<void> {
  try {
    await ensureVectorSchema();
  } finally {
    await pool.end();
  }
}
