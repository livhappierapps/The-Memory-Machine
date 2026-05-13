/**
 * memory.ts — Smart memory retrieval engine.
 *
 * Assembles a ranked list of past conversation snippets to inject as context
 * before each Grok request. Priority order:
 *   1. Pinned threads (always included)
 *   2. Semantically similar threads (cosine similarity on pgvector)
 *   3. Most recent sessions (fill remaining slots)
 *
 * Returns the assembled messages list plus a sources array for the
 * "What Leo knows" UI panel.
 */

import { db } from "@workspace/db";
import { threadsTable, messagesTable } from "@workspace/db";
import { eq, and, desc, not, inArray, sql } from "drizzle-orm";
import { generateEmbedding } from "./embeddings";
import { logger } from "./logger";

export interface MemorySource {
  threadId: number;
  title: string;
  reason: "pinned" | "semantic" | "recent";
  relevanceScore: number | null;
  messageCount: number;
}

export interface MemoryContext {
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  sources: MemorySource[];
}

export interface RetrieveMemoriesOptions {
  profileId: number;
  userId: string;
  currentThreadId: number;
  query: string;
  smartRetrieval: boolean;
  topN: number;
  alwaysIncludeLastN: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  apiKey: string;
  embeddingProvider?: string;
}

const MAX_MESSAGES_PER_THREAD = 8;
const MAX_SUMMARY_CHARS = 2000;
/** Soft character budget for all injected memory context (avoids huge context windows). */
const MAX_TOTAL_CONTEXT_CHARS = 40_000;

/** Load the best representative messages from a thread for context injection. */
async function loadThreadSnippet(
  threadId: number,
): Promise<Array<{ role: "user" | "assistant" | "system"; content: string }>> {
  // Prefer summary messages if available
  const summaries = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.threadId, threadId), eq(messagesTable.isSummary, true)))
    .limit(1);

  if (summaries.length > 0) {
    return [
      {
        role: "system" as const,
        content: `[Memory from past conversation: ${summaries[0]!.content.slice(0, MAX_SUMMARY_CHARS)}]`,
      },
    ];
  }

  // Otherwise take last N messages
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.threadId, threadId))
    .orderBy(desc(messagesTable.createdAt))
    .limit(MAX_MESSAGES_PER_THREAD);

  return msgs.reverse().map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));
}

export async function retrieveMemories(
  opts: RetrieveMemoriesOptions,
): Promise<MemoryContext> {
  const {
    profileId,
    userId,
    currentThreadId,
    query,
    smartRetrieval,
    topN,
    alwaysIncludeLastN,
    dateFrom,
    dateTo,
    apiKey,
    embeddingProvider = "xai",
  } = opts;

  const sources: MemorySource[] = [];
  const includedThreadIds = new Set<number>([currentThreadId]);

  // ── 1. Build base condition for other threads ──────────────────────────────
  const otherThreadsBase = and(
    eq(threadsTable.userId, userId),
    eq(threadsTable.profileId, profileId),
    eq(threadsTable.archived, false),
    not(eq(threadsTable.id, currentThreadId)),
  );

  // ── 2. Pinned threads (always include) ────────────────────────────────────
  const pinnedThreads = await db
    .select()
    .from(threadsTable)
    .where(and(otherThreadsBase!, eq(threadsTable.pinned, true)))
    .limit(20);

  for (const t of pinnedThreads) {
    if (!includedThreadIds.has(t.id)) {
      includedThreadIds.add(t.id);
      sources.push({
        threadId: t.id,
        title: t.title,
        reason: "pinned",
        relevanceScore: null,
        messageCount: t.messageCount,
      });
    }
  }

  // ── 3. Semantic similarity search via pgvector ────────────────────────────
  if (smartRetrieval && topN > 0) {
    const queryVec = await generateEmbedding(query, apiKey, embeddingProvider);

    if (queryVec) {
      const vecLiteral = `[${queryVec.join(",")}]`;

      // Build date filter SQL fragment
      let dateFilter = sql``;
      if (dateFrom) {
        const d = new Date(dateFrom);
        if (!isNaN(d.getTime())) {
          dateFilter = sql`${dateFilter} AND t.created_at >= ${d.toISOString()}::timestamptz`;
        }
      }
      if (dateTo) {
        const d = new Date(dateTo + "T23:59:59Z");
        if (!isNaN(d.getTime())) {
          dateFilter = sql`${dateFilter} AND t.created_at <= ${d.toISOString()}::timestamptz`;
        }
      }

      try {
        type SimilarRow = {
          thread_id: number;
          title: string;
          message_count: number;
          memory_weight: number;
          score: number;
        };

        const similarRows = await db.execute<SimilarRow>(sql`
          SELECT thread_id, title, message_count, memory_weight, score
          FROM (
            SELECT DISTINCT ON (e.thread_id)
              e.thread_id,
              t.title,
              t.message_count,
              t.memory_weight,
              1 - (e.embedding <=> ${vecLiteral}::vector) AS score
            FROM embeddings e
            JOIN threads t ON t.id = e.thread_id
            WHERE t.user_id = ${userId}
              AND t.profile_id = ${profileId}
              AND t.archived = false
              AND t.id != ${currentThreadId}
              ${dateFilter}
            ORDER BY e.thread_id, e.embedding <=> ${vecLiteral}::vector
          ) best_per_thread
          ORDER BY score DESC
          LIMIT ${topN}
        `);

        // Sort by similarity score, pick top N that aren't already pinned
        const sorted = [...similarRows.rows]
          .sort((a, b) => b.score - a.score)
          .filter((r) => !includedThreadIds.has(r.thread_id))
          .slice(0, topN);

        for (const row of sorted) {
          includedThreadIds.add(row.thread_id);
          sources.push({
            threadId: row.thread_id,
            title: row.title,
            reason: "semantic",
            relevanceScore: Math.round(row.score * 100) / 100,
            messageCount: row.message_count,
          });
        }
      } catch (err) {
        logger.warn({ err }, "Semantic memory search failed — falling back to recency only");
      }
    } else {
      logger.debug("No query embedding — skipping semantic retrieval");
    }
  }

  // ── 4. Recent sessions (fill remaining slots) ──────────────────────────────
  if (alwaysIncludeLastN > 0) {
    const recentThreads = await db
      .select()
      .from(threadsTable)
      .where(otherThreadsBase!)
      .orderBy(desc(threadsTable.lastMessageAt), desc(threadsTable.createdAt))
      .limit(alwaysIncludeLastN + 5); // fetch extra to account for already-included ones

    let recentAdded = 0;
    for (const t of recentThreads) {
      if (recentAdded >= alwaysIncludeLastN) break;
      if (!includedThreadIds.has(t.id)) {
        includedThreadIds.add(t.id);
        recentAdded++;
        sources.push({
          threadId: t.id,
          title: t.title,
          reason: "recent",
          relevanceScore: null,
          messageCount: t.messageCount,
        });
      }
    }
  }

  // ── 5. Load snippets for each source thread (respect context budget) ─────
  const contextMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
  let totalChars = 0;

  for (const src of sources) {
    if (totalChars >= MAX_TOTAL_CONTEXT_CHARS) {
      logger.debug({ threadId: src.threadId }, "Context budget exhausted — skipping memory thread");
      break;
    }
    try {
      const snippet = await loadThreadSnippet(src.threadId);
      if (snippet.length > 0) {
        const snippetChars = snippet.reduce((acc, m) => acc + m.content.length, 0);
        if (totalChars + snippetChars > MAX_TOTAL_CONTEXT_CHARS && contextMessages.length > 0) {
          // Skip this source to stay under budget (but always include at least one)
          logger.debug({ threadId: src.threadId, snippetChars }, "Memory snippet skipped — would exceed context budget");
          break;
        }
        // Prefix the block so Leo knows this is from memory
        contextMessages.push({
          role: "system",
          content: `--- Memory: "${src.title}" (${src.reason}) ---`,
        });
        contextMessages.push(...snippet);
        totalChars += snippetChars;
      }
    } catch (err) {
      logger.warn({ err, threadId: src.threadId }, "Failed to load snippet for memory thread");
    }
  }

  // ── 6. Increment memoryWeight for retrieved threads ───────────────────────
  const retrievedIds = sources.map((s) => s.threadId);
  if (retrievedIds.length > 0) {
    db.execute(sql`
      UPDATE threads
      SET memory_weight = memory_weight + 1
      WHERE id = ANY(${retrievedIds}::int[])
    `).catch((err) => logger.warn({ err }, "Failed to update memoryWeight"));
  }

  return { messages: contextMessages, sources };
}
