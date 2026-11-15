/**
 * Legacy user mapping — keeps existing data reachable after moving to a new
 * Clerk instance.
 *
 * Why: every row is keyed by the Clerk user ID from the old (Replit-managed)
 * Clerk instance, and field encryption keys are derived from that same ID
 * (see field-crypto.ts). A new Clerk instance issues new user IDs, so without a
 * mapping the data would be orphaned and encrypted fields unreadable.
 *
 * How: when LEGACY_USER_MAPPING=email, a signed-in Clerk user whose *verified*
 * email appears in the operator-provided seed (LEGACY_USER_SEED) is linked,
 * once, to the legacy user ID. From then on the app uses the legacy ID as the
 * data/encryption user ID (req.userId) and the real Clerk ID (req.clerkUserId)
 * only for Clerk API calls.
 *
 * Safety:
 *  - Off by default. With mapping off nothing changes and no table is created.
 *  - Only verified email addresses match; matching is case-insensitive.
 *  - Seed entries come only from server configuration, never from users.
 *  - Each legacy ID can be linked to exactly one Clerk user (UNIQUE), and each
 *    Clerk user to one legacy ID (PRIMARY KEY). Conflicts are refused.
 *  - Schema change is additive: CREATE TABLE IF NOT EXISTS legacy_user_links.
 *
 * LEGACY_USER_SEED format (JSON array):
 *   [{"email":"person@example.com","legacyUserId":"user_2abc..."}]
 */
import { clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import {
  getLegacyMappingMode,
  matchVerifiedEmail,
  parseLegacySeed,
} from "./legacy-user-seed";

export {
  getLegacyMappingMode,
  matchVerifiedEmail,
  parseLegacySeed,
} from "./legacy-user-seed";
export type { LegacyMappingMode, LegacySeedEntry } from "./legacy-user-seed";

let seedCache: Map<string, string> | null = null;
function seed(): Map<string, string> {
  if (!seedCache) seedCache = parseLegacySeed(process.env.LEGACY_USER_SEED);
  return seedCache;
}

let schemaReady: Promise<void> | null = null;
export function ensureLegacyUserLinkSchema(): Promise<void> {
  if (getLegacyMappingMode() === "off") return Promise.resolve();
  if (!schemaReady) {
    schemaReady = db
      .execute(sql`
        CREATE TABLE IF NOT EXISTS legacy_user_links (
          clerk_user_id  TEXT PRIMARY KEY,
          legacy_user_id TEXT NOT NULL UNIQUE,
          linked_email   TEXT NOT NULL,
          linked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

// Small in-process caches; links never change once written.
const toData = new Map<string, string>();
const toClerk = new Map<string, string>();

function remember(clerkUserId: string, dataUserId: string): void {
  toData.set(clerkUserId, dataUserId);
  toClerk.set(dataUserId, clerkUserId);
}

/**
 * Returns the user ID to use for data and encryption for a signed-in Clerk
 * user. Falls back to the Clerk ID itself whenever mapping is off, the user
 * has no matching verified email, or anything goes wrong.
 */
export async function resolveDataUserId(clerkUserId: string): Promise<string> {
  if (getLegacyMappingMode() === "off") return clerkUserId;
  const cached = toData.get(clerkUserId);
  if (cached) return cached;
  try {
    await ensureLegacyUserLinkSchema();
    const existing = await db.execute(sql`
      SELECT legacy_user_id FROM legacy_user_links WHERE clerk_user_id = ${clerkUserId}
    `);
    const row = (existing as unknown as { rows: { legacy_user_id: string }[] }).rows[0];
    if (row) {
      remember(clerkUserId, row.legacy_user_id);
      return row.legacy_user_id;
    }
    if (seed().size === 0) return clerkUserId;

    const user = await clerkClient.users.getUser(clerkUserId);
    const emails = (user.emailAddresses ?? []).map((e) => ({
      emailAddress: e.emailAddress,
      verified: e.verification?.status === "verified",
    }));
    const legacyUserId = matchVerifiedEmail(emails, seed());
    if (!legacyUserId) return clerkUserId;
    const linkedEmail =
      emails.find((e) => e.verified && seed().get(e.emailAddress.trim().toLowerCase()) === legacyUserId)
        ?.emailAddress.toLowerCase() ?? "";

    const inserted = await db.execute(sql`
      INSERT INTO legacy_user_links (clerk_user_id, legacy_user_id, linked_email)
      VALUES (${clerkUserId}, ${legacyUserId}, ${linkedEmail})
      ON CONFLICT DO NOTHING
      RETURNING legacy_user_id
    `);
    if ((inserted as unknown as { rows: unknown[] }).rows.length === 0) {
      // Either this Clerk user was linked concurrently, or the legacy ID is
      // already linked to a different Clerk user. Re-read; refuse otherwise.
      const again = await db.execute(sql`
        SELECT legacy_user_id FROM legacy_user_links WHERE clerk_user_id = ${clerkUserId}
      `);
      const r = (again as unknown as { rows: { legacy_user_id: string }[] }).rows[0];
      if (r) {
        remember(clerkUserId, r.legacy_user_id);
        return r.legacy_user_id;
      }
      logger.warn("Legacy user ID already linked to another account; not linking");
      return clerkUserId;
    }
    logger.info("Linked new Clerk user to legacy user ID");
    remember(clerkUserId, legacyUserId);
    return legacyUserId;
  } catch (err) {
    logger.error({ err }, "Legacy user mapping failed; using Clerk user ID");
    return clerkUserId;
  }
}

/**
 * Returns the Clerk user ID to use for Clerk API calls for a data user ID.
 * Identity when mapping is off or no link exists.
 */
export async function resolveClerkUserId(dataUserId: string): Promise<string> {
  if (getLegacyMappingMode() === "off") return dataUserId;
  const cached = toClerk.get(dataUserId);
  if (cached) return cached;
  try {
    await ensureLegacyUserLinkSchema();
    const res = await db.execute(sql`
      SELECT clerk_user_id FROM legacy_user_links WHERE legacy_user_id = ${dataUserId}
    `);
    const row = (res as unknown as { rows: { clerk_user_id: string }[] }).rows[0];
    if (row) {
      remember(row.clerk_user_id, dataUserId);
      return row.clerk_user_id;
    }
  } catch (err) {
    logger.error({ err }, "Legacy user reverse lookup failed");
  }
  return dataUserId;
}
