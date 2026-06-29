import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { threadsTable, messagesTable, profilesTable, settingsTable } from "@workspace/db";
import { eq, and, desc, count, ilike, gte, lte, isNull } from "drizzle-orm";
import { retrieveMemories } from "../lib/memory";
import { isPgvectorAvailable } from "../lib/db-bootstrap";
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

    if (query.search) {
      conditions.push(ilike(threadsTable.title, `%${query.search}%`));
    }

    // Profile filter
    const rawProfileId = req.query.profileId as string | undefined;
    if (rawProfileId) {
      const pid = parseInt(rawProfileId, 10);
      if (!isNaN(pid)) {
        conditions.push(eq(threadsTable.profileId, pid));
      }
    }

    // Date range filter
    const rawFrom = req.query.from as string | undefined;
    const rawTo = req.query.to as string | undefined;
    if (rawFrom) {
      const d = new Date(rawFrom);
      if (!isNaN(d.getTime())) conditions.push(gte(threadsTable.createdAt, d));
    }
    if (rawTo) {
      const d = new Date(rawTo + "T23:59:59Z");
      if (!isNaN(d.getTime())) conditions.push(lte(threadsTable.createdAt, d));
    }

    const rows = await db
      .select()
      .from(threadsTable)
      .where(and(...conditions))
      .orderBy(desc(threadsTable.pinned), desc(threadsTable.lastMessageAt), desc(threadsTable.createdAt));

    res.json(rows);
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

// Get recently soft-deleted threads (30-day restore window)
router.get("/threads/deleted", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

    const rows = await db
      .select()
      .from(threadsTable)
      .where(
        and(
          eq(threadsTable.userId, userId),
          gte(threadsTable.deletedAt, cutoff),
        ),
      )
      .orderBy(desc(threadsTable.deletedAt));

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list deleted threads");
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

    // profile.apiKey / openAiApiKey are encrypted at rest — decrypt before use.
    const embeddingProvider = profile.embeddingProvider ?? "xai";
    const xaiApiKey =
      (profile.apiKey ? decryptField(userId, profile.apiKey) : null) ||
      (settings?.apiKey ? decryptField(userId, settings.apiKey) : null);
    const embeddingApiKey =
      (embeddingProvider === "openai" && profile.openAiApiKey
        ? decryptField(userId, profile.openAiApiKey)
        : null) ?? xaiApiKey;

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
