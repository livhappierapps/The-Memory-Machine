// One definition of a user's "default" profile, shared by MCP, settings,
// import, thread creation and memory retrieval.
//
// Default = the oldest profile (created_at ASC, id ASC as a tie-break). This
// is the "Default" profile created on first sign-in by ensureDefaultProfile.

import { db, profilesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

export type Profile = typeof profilesTable.$inferSelect;

/** Ordering used everywhere a "first"/default profile is picked. */
export const DEFAULT_PROFILE_ORDER = [asc(profilesTable.createdAt), asc(profilesTable.id)] as const;

export async function getDefaultProfile(userId: string): Promise<Profile | null> {
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId))
    .orderBy(...DEFAULT_PROFILE_ORDER)
    .limit(1);
  return profile ?? null;
}

/** All of a user's profiles, default first. */
export async function listProfiles(userId: string): Promise<Profile[]> {
  return db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId))
    .orderBy(...DEFAULT_PROFILE_ORDER);
}

/**
 * Pick the profile for a request: the requested one if it belongs to the
 * user, otherwise the default. Pure helper over an already-loaded list.
 */
export function pickProfile<P extends { id: number }>(profiles: P[], requestedId?: number | null): P | null {
  if (requestedId != null) {
    const found = profiles.find((p) => p.id === requestedId);
    if (found) return found;
  }
  return profiles[0] ?? null;
}
