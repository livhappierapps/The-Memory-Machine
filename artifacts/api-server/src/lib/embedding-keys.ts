// DB-backed helpers for resolving the embedding key of a thread/profile.

import { db, profilesTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveEmbeddingKey, type ResolvedEmbeddingKey } from "./embedding-config";

/**
 * Resolve the embedding provider + plaintext key for content in a thread.
 * Uses the thread's profile key, then legacy settings.apiKey, then the
 * server-level key (XAI_API_KEY / EMBEDDING_API_KEY). Works for threads with no
 * profile (profileId null).
 */
export async function loadEmbeddingKeyForThread(
  userId: string,
  profileId: number | null | undefined,
): Promise<ResolvedEmbeddingKey | null> {
  const profile = profileId
    ? (
        await db
          .select({
            apiKey: profilesTable.apiKey,
            openAiApiKey: profilesTable.openAiApiKey,
            embeddingProvider: profilesTable.embeddingProvider,
            userId: profilesTable.userId,
          })
          .from(profilesTable)
          .where(eq(profilesTable.id, profileId))
      )[0]
    : undefined;
  // Never use another user's profile key.
  const ownProfile = profile && profile.userId === userId ? profile : null;
  const [settings] = await db
    .select({ apiKey: settingsTable.apiKey })
    .from(settingsTable)
    .where(eq(settingsTable.userId, userId));
  return resolveEmbeddingKey(userId, ownProfile, { settingsApiKey: settings?.apiKey ?? null });
}
