import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { threadsTable, messagesTable, profilesTable, settingsTable } from "@workspace/db";
import { eq, and, desc, count, ilike, gte, lte, isNull, inArray, asc, sql } from "drizzle-orm";
import { retrieveMemories } from "../lib/memory";
import { isPgvectorAvailable } from "../lib/db-bootstrap";
import { generateEmbedding } from "../lib/embeddings";
import { resolveEmbeddingKey } from "../lib/embedding-config";
import {
  CreateThreadBody,
  UpdateThreadBody,
  ListThreadsQueryParams,
  GetThreadParams,
  UpdateThreadParams,
  DeleteThreadParams,
  ExportThreadParams,
  ExportThreadQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { ensureDefaultProfile } from "./profiles";
import { decryptField } from "../lib/field-crypto";

const router: IRouter = Router();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// List threads
router.get("/threads", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    // Deterministic migration: ensure the user has a Default profile (creates one if not)
    // This runs on every thread list call so it's guaranteed to execute before any thread interaction
    await ensureDefaultProfile(userId);

    // zod.coerce.boolean() converts the string "false" to true — handle manually
    const rawQuery = { ...req.query };
    if (rawQuery.archived === "false") (rawQuery as any).archived = false;
    else if (rawQuery.archived === "true") (rawQuery as any).archived = true;

    const parsed = ListThreadsQueryParams.safeParse(rawQuery);
    const query = parsed.success ? parsed.data : {};

    const conditions = [eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt)];

    if (query.archived !== undefined) {
      conditions.push(eq(threadsTable.archived, query.archived));
    }

    // ── Extract filter values — used in both Drizzle conditions and vector SQL ─
    // Parsing once here lets the vector candidate query apply the same active
    // filters before its LIMIT, preventing valid results from being crowded out
    // by high-scoring threads that would be excluded by an active filter anyway.

    const rawProfileId = req.query.profileId as string | undefined;
    const requestedProfileId = rawProfileId ? parseInt(rawProfileId, 10) : NaN;
    if (!isNaN(requestedProfileId)) {
      conditions.push(eq(threadsTable.profileId, requestedProfileId));
    }

    const rawFrom = req.query.from as string | undefined;
    const rawTo = req.query.to as string | undefined;
    const fromDate = rawFrom ? (() => { const d = new Date(rawFrom); return isNaN(d.getTime()) ? null : d; })() : null;
    const toDate = rawTo ? (() => { const d = new Date(rawTo + "T23:59:59Z"); return isNaN(d.getTime()) ? null : d; })() : null;
    if (fromDate) conditions.push(gte(threadsTable.createdAt, fromDate));
    if (toDate) conditions.push(lte(threadsTable.createdAt, toDate));

    const rawSource = req.query.source as string | undefined;
    const activeSource = rawSource === "mcp" || rawSource === "chat" ? rawSource : null;
    if (activeSource) conditions.push(eq(threadsTable.source, activeSource));

    // ── Search: hybrid semantic + keyword ────────────────────────────────────
    // Combines pgvector cosine similarity with keyword title search.
    //
    // Ranking:  semantic group first (by score, pin within), then keyword-only
    //           group (pin within). A pinned keyword-only hit must NOT outrank
    //           an unpinned semantic hit.
    //
    // Profile isolation: the embedding API key and vector candidate set are
    // both scoped to the requested profile when a profileId filter is active.
    //
    // Filters in vector SQL: archived, date-range, and source constraints are
    // applied inside the vector subquery before LIMIT so that high-scoring
    // threads excluded by those filters do not consume candidate slots.
    const SEMANTIC_SEARCH_TIMEOUT_MS = 3_000;
    let semanticThreadIds: number[] = [];

    if (query.search) {
      const searchTerm = query.search;

      if (isPgvectorAvailable()) {
        try {
          // Load the profile whose API key to use:
          // - requested profile (ownership-verified) if a profileId filter was supplied
          // - otherwise the user's default (first) profile
          const profileRows = !isNaN(requestedProfileId)
            ? await db
                .select({
                  id: profilesTable.id,
                  apiKey: profilesTable.apiKey,
                  openAiApiKey: profilesTable.openAiApiKey,
                  embeddingProvider: profilesTable.embeddingProvider,
                })
                .from(profilesTable)
                .where(and(eq(profilesTable.id, requestedProfileId), eq(profilesTable.userId, userId)))
                .limit(1)
            : await db
                .select({
                  id: profilesTable.id,
                  apiKey: profilesTable.apiKey,
                  openAiApiKey: profilesTable.openAiApiKey,
                  embeddingProvider: profilesTable.embeddingProvider,
                })
                .from(profilesTable)
                .where(eq(profilesTable.userId, userId))
                .orderBy(asc(profilesTable.id))
                .limit(1);

          const profile = profileRows[0];
          const [settingsRow] = await db
            .select({ apiKey: settingsTable.apiKey })
            .from(settingsTable)
            .where(eq(settingsTable.userId, userId))
            .limit(1);
          // Provider-aware key resolution shared with retrieval/MCP: profile key →
          // settings key → server-level key. Works even if the user has no profile.
          const emb = resolveEmbeddingKey(userId, profile ?? null, {
            settingsApiKey: settingsRow?.apiKey ?? null,
          });

          {
            const apiKey = emb?.apiKey ?? null;
            const provider = emb?.provider ?? "xai";
            if (apiKey) {
              // Time-bound the embedding API call: a slow or rate-limited provider
              // must not hang the thread-list response. Timeout → keyword-only fallback.
              const queryVec = await Promise.race([
                generateEmbedding(searchTerm, apiKey, provider, "query"),
                new Promise<null>((resolve) =>
                  setTimeout(() => resolve(null), SEMANTIC_SEARCH_TIMEOUT_MS),
                ),
              ]);

              if (queryVec) {
                const vecLiteral = `[${queryVec.join(",")}]`;
                type SemRow = { thread_id: number };

                // Build optional SQL filter fragments that mirror the active
                // Drizzle conditions so the vector LIMIT is not wasted on threads
                // that would be excluded by the outer query anyway.
                const profileIdSql = !isNaN(requestedProfileId)
                  ? sql`AND e.profile_id = ${requestedProfileId}`
                  : sql``;
                const archivedSql = query.archived !== undefined
                  ? sql`AND t.archived = ${query.archived}`
                  : sql``;
                const fromSql = fromDate ? sql`AND t.created_at >= ${fromDate}` : sql``;
                const toSql = toDate ? sql`AND t.created_at <= ${toDate}` : sql``;
                const sourceSql = activeSource ? sql`AND t.source = ${activeSource}` : sql``;

                const semResult = await db.execute<SemRow>(sql`
                  SELECT thread_id
                  FROM (
                    SELECT DISTINCT ON (e.thread_id)
                      e.thread_id,
                      1 - (e.embedding <=> ${vecLiteral}::vector) AS score
                    FROM embeddings e
                    JOIN threads t ON t.id = e.thread_id
                    WHERE t.user_id = ${userId}
                      AND t.deleted_at IS NULL
                      ${profileIdSql}
                      ${archivedSql}
                      ${fromSql}
                      ${toSql}
                      ${sourceSql}
                    ORDER BY e.thread_id, e.embedding <=> ${vecLiteral}::vector
                  ) best_per_thread
                  WHERE score > 0.3
                  ORDER BY score DESC
                  LIMIT 40
                `);
                semanticThreadIds = semResult.rows.map((r) => r.thread_id);
              }
            }
          }
        } catch (err) {
          req.log.warn({ err }, "Semantic search failed — falling back to keyword only");
        }
      }

      // Keyword search on thread title — applies all active conditions (profile,
      // archived, date-range, source) before scanning so filters do not
      // silently exclude qualifying matches.  No artificial row cap: the outer
      // query is the authoritative limit and the inArray condition keeps the
      // result set well-bounded.
      const titleRows = await db
        .select({ id: threadsTable.id })
        .from(threadsTable)
        .where(
          and(
            ...conditions,
            ilike(threadsTable.title, `%${searchTerm}%`),
          ),
        );

      // Merge: semantic thread IDs first (meaning-aware), then keyword-only hits
      const keywordOnlyIds = titleRows
        .map((r) => r.id)
        .filter((id) => !semanticThreadIds.includes(id));
      const mergedIds = [...semanticThreadIds, ...keywordOnlyIds];

      if (mergedIds.length === 0) {
        res.json([]);
        return;
      }

      conditions.push(inArray(threadsTable.id, mergedIds));
    }

    const rows = await db
      .select()
      .from(threadsTable)
      .where(and(...conditions))
      .orderBy(desc(threadsTable.pinned), desc(threadsTable.lastMessageAt), desc(threadsTable.createdAt));

    // ── Re-sort search results to honour semantic ranking ────────────────────
    // Final order requirements:
    //   1. Semantic group before keyword-only group.
    //   2. Within the semantic group: descending vector score (the order of
    //      semanticThreadIds from the SQL query), with pin only as a tie-break
    //      when two results share the same score position.
    //   3. Within the keyword-only group: pinned first, then recency (the outer
    //      DB orderBy already satisfies this; stable sort preserves it).
    //
    // A pinned keyword-only hit must NOT outrank an unpinned semantic hit.
    // A lower-similarity pinned semantic hit must NOT outrank a higher-similarity
    // unpinned semantic hit — score is the primary ordering within the group.
    let result = rows;
    if (query.search && semanticThreadIds.length > 0) {
      const semSet = new Set(semanticThreadIds);
      // semOrder[id] = position in descending-score array (0 = best match)
      const semOrder = new Map(semanticThreadIds.map((id, i) => [id, i]));
      result = rows.slice().sort((a, b) => {
        // Primary: semantic group before keyword-only group
        const aSem = semSet.has(a.id) ? 0 : 1;
        const bSem = semSet.has(b.id) ? 0 : 1;
        if (aSem !== bSem) return aSem - bSem;

        if (aSem === 0) {
          // Within semantic group: score is primary (lower position index = higher score)
          const scoreOrder = (semOrder.get(a.id) ?? 999) - (semOrder.get(b.id) ?? 999);
          if (scoreOrder !== 0) return scoreOrder;
          // Tie-break by pin (pinned first) then rely on stable sort for recency
          return (a.pinned ? 0 : 1) - (b.pinned ? 0 : 1);
        }

        // Within keyword-only group: pinned first; recency preserved by stable sort
        return (a.pinned ? 0 : 1) - (b.pinned ? 0 : 1);
      });
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list threads");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create thread
router.post("/threads", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const parsed = CreateThreadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      return;
    }

    // Resolve the target profile:
    // - If profileId is provided, verify ownership and capture its defaultModel
    // - If omitted, fall back to the user's first (Default) profile so all threads are scoped
    let resolvedProfileId: number | null = parsed.data.profileId ?? null;
    let profileDefaultModel: string | null = null;

    if (resolvedProfileId != null) {
      const [profile] = await db
        .select({ id: profilesTable.id, defaultModel: profilesTable.defaultModel })
        .from(profilesTable)
        .where(and(eq(profilesTable.id, resolvedProfileId), eq(profilesTable.userId, userId)));
      if (!profile) {
        res.status(403).json({ error: "Profile not found or does not belong to you" });
        return;
      }
      profileDefaultModel = profile.defaultModel ?? null;
    } else {
      // Default to the user's first profile (ensureDefaultProfile guarantees at least one exists)
      const userProfiles = await ensureDefaultProfile(userId);
      if (userProfiles.length > 0) {
        resolvedProfileId = userProfiles[0].id;
        profileDefaultModel = userProfiles[0].defaultModel ?? null;
      }
    }

    // Model priority: explicit request model > profile defaultModel > hardcoded fallback
    const model = parsed.data.model ?? profileDefaultModel ?? "grok-3";

    const [thread] = await db
      .insert(threadsTable)
      .values({
        userId,
        title: parsed.data.title,
        model,
        profileId: resolvedProfileId,
      })
      .returning();

    res.status(201).json(thread);
  } catch (err) {
    req.log.error({ err }, "Failed to create thread");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Literal collection routes must precede /threads/:threadId.
router.get("/threads/deleted", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
    const rows = await db
      .select()
      .from(threadsTable)
      .where(and(eq(threadsTable.userId, userId), gte(threadsTable.deletedAt, cutoff)))
      .orderBy(desc(threadsTable.deletedAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list deleted threads");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get thread
router.get("/threads/:threadId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = GetThreadParams.safeParse({ threadId: req.params.threadId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }

    const [thread] = await db
      .select()
      .from(threadsTable)
      .where(and(eq(threadsTable.id, params.data.threadId), eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt)));

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    res.json(thread);
  } catch (err) {
    req.log.error({ err }, "Failed to get thread");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update thread
router.patch("/threads/:threadId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = UpdateThreadParams.safeParse({ threadId: req.params.threadId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }
    const parsed = UpdateThreadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      return;
    }

    const [thread] = await db
      .update(threadsTable)
      .set(parsed.data)
      .where(and(eq(threadsTable.id, params.data.threadId), eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt)))
      .returning();

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    res.json(thread);
  } catch (err) {
    req.log.error({ err }, "Failed to update thread");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Direct thread deletion is disabled — all deletion must go through the
// deletion-requests state machine (OTP + 2FA + safety waiting period).
// This endpoint returns 405 so API clients get a clear, actionable error.
router.delete("/threads/:threadId", requireAuth, (_req: Request, res: Response) => {
  res.status(405).json({
    error: "direct_delete_disabled",
    message:
      "Thread deletion requires the protected deletion-requests flow (2FA + OTP + " +
      "safety waiting period). Use POST /api/deletion-requests with targetType='thread'.",
  });
});

// Restore soft-deleted thread
router.patch("/threads/:threadId/restore", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const threadId = parseInt(req.params.threadId as string, 10);
    if (isNaN(threadId)) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }

    const [thread] = await db
      .update(threadsTable)
      .set({ deletedAt: null })
      .where(and(eq(threadsTable.id, threadId), eq(threadsTable.userId, userId)))
      .returning();

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    res.json(thread);
  } catch (err) {
    req.log.error({ err }, "Failed to restore thread");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Export thread
router.get("/threads/:threadId/export", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = ExportThreadParams.safeParse({ threadId: req.params.threadId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }
    const queryParsed = ExportThreadQueryParams.safeParse(req.query);
    const format = queryParsed.success ? (queryParsed.data.format ?? "json") : "json";

    const [thread] = await db
      .select()
      .from(threadsTable)
      .where(and(eq(threadsTable.id, params.data.threadId), eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt)));

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    const rawMessages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.threadId, params.data.threadId))
      .orderBy(messagesTable.createdAt);

    const messages = rawMessages.map((m) => ({
      ...m,
      content: decryptField(userId, m.content),
    }));

    let content: string;
    if (format === "markdown") {
      const lines = [`# ${thread.title}`, "", `*Exported on ${new Date().toISOString()}*`, ""];
      for (const msg of messages) {
        lines.push(`## ${msg.role === "user" ? "You" : "Grok"}`, "");
        lines.push(msg.content, "");
      }
      content = lines.join("\n");
    } else {
      content = JSON.stringify({ thread, messages }, null, 2);
    }

    res.json({
      threadId: thread.id,
      title: thread.title,
      format,
      content,
      exportedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to export thread");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Memory preview — show which memories would be retrieved for a given query
router.get("/threads/:threadId/memory-preview", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const threadId = parseInt(req.params.threadId as string, 10);
    if (isNaN(threadId)) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }

    const rawQ = req.query.q;
    const query = typeof rawQ === "string" ? rawQ : Array.isArray(rawQ) ? String(rawQ[0]) : "";

    const [thread] = await db
      .select()
      .from(threadsTable)
      .where(and(eq(threadsTable.id, threadId), eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt)));

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    if (!thread.profileId) {
      res.json({ sources: [], totalContextMessages: 0, smartRetrievalEnabled: false, pgvectorAvailable: isPgvectorAvailable() });
      return;
    }

    const [profile] = await db
      .select()
      .from(profilesTable)
      .where(and(eq(profilesTable.id, thread.profileId), eq(profilesTable.userId, userId)));

    if (!profile) {
      res.json({ sources: [], totalContextMessages: 0, smartRetrievalEnabled: false, pgvectorAvailable: isPgvectorAvailable() });
      return;
    }

    // Fall back to global settings API key for xAI embeddings
    const [settings] = await db
      .select({ apiKey: settingsTable.apiKey })
      .from(settingsTable)
      .where(eq(settingsTable.userId, userId));

    // Shared provider-aware resolution (profile → settings → server key).
    const emb = resolveEmbeddingKey(userId, profile, { settingsApiKey: settings?.apiKey ?? null });
    const embeddingApiKey = emb?.apiKey ?? null;
    const embeddingProvider = emb?.provider ?? "xai";

    if (!embeddingApiKey) {
      res.json({ sources: [], totalContextMessages: 0, smartRetrievalEnabled: profile.smartRetrieval, pgvectorAvailable: isPgvectorAvailable() });
      return;
    }

    const memoryResult = await retrieveMemories({
      profileId: profile.id,
      userId,
      currentThreadId: threadId,
      query: query || "What do I remember?",
      smartRetrieval: profile.smartRetrieval,
      topN: profile.topNMemories,
      alwaysIncludeLastN: profile.alwaysIncludeLastN,
      dateFrom: profile.memoryDateFrom,
      dateTo: profile.memoryDateTo,
      apiKey: embeddingApiKey,
      embeddingProvider,
      // Preview calls must not inflate memory_weight usage counts
      trackUsage: false,
    });

    res.json({
      sources: memoryResult.sources,
      totalContextMessages: memoryResult.messages.length,
      smartRetrievalEnabled: profile.smartRetrieval,
      pgvectorAvailable: isPgvectorAvailable(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get memory preview");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
