/**
 * Pure helpers for the optional legacy user mapping (see legacy-user-map.ts).
 * Kept free of database/Clerk imports so they can be unit tested.
 */
import { logger } from "./logger";

export type LegacyMappingMode = "off" | "email";

export interface LegacySeedEntry {
  email: string;
  legacyUserId: string;
}

export function getLegacyMappingMode(env: NodeJS.ProcessEnv = process.env): LegacyMappingMode {
  return env.LEGACY_USER_MAPPING?.trim().toLowerCase() === "email" ? "email" : "off";
}

export function parseLegacySeed(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw?.trim()) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error("LEGACY_USER_SEED is not valid JSON; legacy mapping disabled");
    return map;
  }
  if (!Array.isArray(parsed)) {
    logger.error("LEGACY_USER_SEED must be a JSON array; legacy mapping disabled");
    return map;
  }
  const seenLegacy = new Set<string>();
  for (const item of parsed as Partial<LegacySeedEntry>[]) {
    const email = typeof item?.email === "string" ? item.email.trim().toLowerCase() : "";
    const legacyUserId = typeof item?.legacyUserId === "string" ? item.legacyUserId.trim() : "";
    if (!email || !legacyUserId) continue;
    if (map.has(email) || seenLegacy.has(legacyUserId)) {
      logger.error("LEGACY_USER_SEED has a duplicate email or legacy ID; entry skipped");
      continue;
    }
    map.set(email, legacyUserId);
    seenLegacy.add(legacyUserId);
  }
  return map;
}

/** Picks the legacy ID for the first verified email that is in the seed. */
export function matchVerifiedEmail(
  emails: { emailAddress: string; verified: boolean }[],
  seed: Map<string, string>,
): string | null {
  for (const e of emails) {
    if (!e.verified) continue;
    const hit = seed.get(e.emailAddress.trim().toLowerCase());
    if (hit) return hit;
  }
  return null;
}
