import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { threadsTable, messagesTable, settingsTable, profilesTable } from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import {
  GetThreadMessagesParams,
  SendMessageParams,
  SendMessageBody,
  ImportMessagesParams,
  ImportMessagesBody,
  StreamMessageParams,
  StreamMessageBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { streamGrokCompletion } from "../lib/grok";
import { embedMessageAsync } from "../lib/embeddings";
import { retrieveMemories } from "../lib/memory";
import { maybeSummarizeAsync } from "../lib/summarizer";

const router: IRouter = Router();


// Get messages for a thread
router.get("/threads/:threadId/messages", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = GetThreadMessagesParams.safeParse({ threadId: req.params.threadId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }

    const [thread] = await db
      .select()
      .from(threadsTable)
      .where(and(eq(threadsTable.id, params.data.threadId), eq(threadsTable.userId, userId)));

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.threadId, params.data.threadId))
      .orderBy(asc(messagesTable.createdAt));

    res.json(messages);
  } catch (err) {
    req.log.error({ err }, "Failed to get messages");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Save user message (non-streaming)
router.post("/threads/:threadId/messages", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = SendMessageParams.safeParse({ threadId: req.params.threadId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }
    const parsed = SendMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      return;
    }

    const [thread] = await db
      .select()
      .from(threadsTable)
      .where(and(eq(threadsTable.id, params.data.threadId), eq(threadsTable.userId, userId)));

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    const [message] = await db
      .insert(messagesTable)
      .values({
        threadId: params.data.threadId,
        role: "user",
        content: parsed.data.content,
        isSummary: false,
      })
      .returning();

    await db
      .update(threadsTable)
      .set({ messageCount: thread.messageCount + 1, lastMessageAt: new Date() })
      .where(eq(threadsTable.id, params.data.threadId));

    res.json(message);

    // ── Async: embed the saved message (best-effort) ───────────────────────
    if (thread.profileId) {
      const [profile] = await db
        .select({ apiKey: profilesTable.apiKey })
        .from(profilesTable)
        .where(eq(profilesTable.id, thread.profileId));
      if (profile?.apiKey) {
        embedMessageAsync(message.id, params.data.threadId, thread.profileId, parsed.data.content, profile.apiKey);
      }
    }
  } catch (err) {
    req.log.error({ err }, "Failed to save message");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Stream Grok response via SSE
router.post("/threads/:threadId/stream", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const params = StreamMessageParams.safeParse({ threadId: req.params.threadId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid thread ID" });
    return;
  }
  const parsed = StreamMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  try {
    const [thread] = await db
      .select()
      .from(threadsTable)
      .where(and(eq(threadsTable.id, params.data.threadId), eq(threadsTable.userId, userId)));

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    // Load profile if thread has one (scoped to this user to prevent cross-user access)
    let profile: typeof profilesTable.$inferSelect | null = null;
    if (thread.profileId) {
      const [p] = await db
        .select()
        .from(profilesTable)
        .where(and(eq(profilesTable.id, thread.profileId), eq(profilesTable.userId, userId)));
      if (p) profile = p;
    }

    const [settings] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.userId, userId));

    // Profile API key takes precedence over global settings fallback
    const apiKey = profile?.apiKey || settings?.apiKey;
    if (!apiKey) {
      res.status(400).json({ error: "No API key configured. Add your Grok API key in the profile editor or Settings." });
      return;
    }

    // Save user message first
    const [userMsg] = await db
      .insert(messagesTable)
      .values({
        threadId: params.data.threadId,
        role: "user",
        content: parsed.data.content,
        isSummary: false,
      })
      .returning();

    // Load current thread history
    const history = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.threadId, params.data.threadId))
      .orderBy(asc(messagesTable.createdAt));

    const model = thread.model || profile?.defaultModel || settings?.defaultModel || "grok-3";
    const maxCtx = profile?.maxContextMessages ?? settings?.maxContextMessages ?? 0;

    // ── Smart memory retrieval ─────────────────────────────────────────────
    const smartRetrieval = profile?.smartRetrieval ?? true;
    const topN = profile?.topNMemories ?? 10;
    const alwaysIncludeLastN = profile?.alwaysIncludeLastN ?? 3;

    let memorySources: Array<{
      threadId: number;
      title: string;
      reason: string;
      relevanceScore: number | null;
      messageCount: number;
    }> = [];
    let memoryMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];

    if (profile && (smartRetrieval || alwaysIncludeLastN > 0)) {
      try {
        const memoryResult = await retrieveMemories({
          profileId: profile.id,
          userId,
          currentThreadId: params.data.threadId,
          query: parsed.data.content,
          smartRetrieval,
          topN,
          alwaysIncludeLastN,
          dateFrom: profile.memoryDateFrom,
          dateTo: profile.memoryDateTo,
          apiKey,
        });
        memorySources = memoryResult.sources;
        memoryMessages = memoryResult.messages;
      } catch (err) {
        req.log.warn({ err }, "Memory retrieval failed — continuing without cross-thread context");
      }
    }

    // ── Assemble Grok messages: system + memory + current thread ──────────
    const grokMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];

    // 1. Personality system prompt
    if (profile?.personalityNotes) {
      grokMessages.push({ role: "system", content: profile.personalityNotes });
    }

    // 2. Cross-thread memory context (pinned + semantic + recent)
    if (memoryMessages.length > 0) {
      grokMessages.push({
        role: "system",
        content: "The following are relevant memories from past conversations:",
      });
      grokMessages.push(...memoryMessages);
      grokMessages.push({
        role: "system",
        content: "--- End of memories — current conversation follows ---",
      });
    }

    // 3. Current thread history (respects maxContextMessages)
    const historyToSend = maxCtx > 0 ? history.slice(-maxCtx) : history;
    grokMessages.push(
      ...historyToSend.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    );

    // ── Set up SSE ────────────────────────────────────────────────────────
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent({ type: "user_message", message: userMsg });

    // Emit memory sources so the frontend can show "What Leo knows"
    if (memorySources.length > 0) {
      sendEvent({ type: "memory_sources", sources: memorySources });
    }

    let fullContent = "";
    await streamGrokCompletion(apiKey, model, grokMessages, {
      onToken: (delta) => {
        fullContent += delta;
        sendEvent({ type: "token", content: delta });
      },
      onError: (message) => {
        req.log.error({ message }, "Grok stream error");
        sendEvent({ type: "error", error: message });
        res.end();
      },
      onDone: () => {},
    });

    if (res.writableEnded) return;

    // Persist assistant response
    const [assistantMsg] = await db
      .insert(messagesTable)
      .values({
        threadId: params.data.threadId,
        role: "assistant",
        content: fullContent,
        isSummary: false,
      })
      .returning();

    await db
      .update(threadsTable)
      .set({ messageCount: thread.messageCount + 2, lastMessageAt: new Date() })
      .where(eq(threadsTable.id, params.data.threadId));

    sendEvent({ type: "done", message: assistantMsg, memorySources });
    res.end();

    // ── Async: generate embeddings for user + assistant messages ──────────
    embedMessageAsync(userMsg.id, params.data.threadId, thread.profileId ?? null, parsed.data.content, apiKey);
    if (fullContent) {
      embedMessageAsync(assistantMsg.id, params.data.threadId, thread.profileId ?? null, fullContent, apiKey);
    }

    // ── Async: summarize thread if it has grown long enough ───────────────
    maybeSummarizeAsync(params.data.threadId, apiKey);
  } catch (err) {
    req.log.error({ err }, "Stream error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else {
      res.end();
    }
  }
});

// Import messages into a thread
router.post("/threads/:threadId/import", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = ImportMessagesParams.safeParse({ threadId: req.params.threadId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }
    const parsed = ImportMessagesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const [thread] = await db
      .select()
      .from(threadsTable)
      .where(and(eq(threadsTable.id, params.data.threadId), eq(threadsTable.userId, userId)));

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    const { raw, format = "auto" } = parsed.data;
    let parsedMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];

    // JSON format
    if (format === "json" || format === "auto") {
      try {
        const json = JSON.parse(raw);
        const isValidMsg = (m: unknown): m is { role: string; content: string } =>
          !!m &&
          typeof (m as any).role === "string" &&
          typeof (m as any).content === "string" &&
          ["user", "assistant", "system"].includes((m as any).role);

        if (Array.isArray(json)) {
          parsedMessages = json.filter(isValidMsg) as typeof parsedMessages;
        } else if (json.messages && Array.isArray(json.messages)) {
          parsedMessages = json.messages.filter(isValidMsg) as typeof parsedMessages;
        }
      } catch {
        // not JSON — fall through to text parsing
      }
    }

    // Text format — supports "You" / "Grok" heading lines and "You: …" inline prefixes
    if (parsedMessages.length === 0 && (format === "text" || format === "auto")) {
      const lines = raw.split("\n");
      let currentRole: "user" | "assistant" | null = null;
      let currentContent: string[] = [];

      const flush = () => {
        if (currentRole && currentContent.length > 0) {
          const text = currentContent.join("\n").trim();
          if (text) parsedMessages.push({ role: currentRole, content: text });
          currentContent = [];
        }
      };

      const USER_HEADING = /^(you|human|user)$/i;
      const ASST_HEADING = /^(grok|assistant|ai|bot)$/i;
      const USER_INLINE = /^(you|human|user)\s*:/i;
      const ASST_INLINE = /^(grok|assistant|ai|bot)\s*:/i;

      for (const line of lines) {
        const trimmed = line.trim();
        if (USER_HEADING.test(trimmed)) {
          flush(); currentRole = "user";
        } else if (ASST_HEADING.test(trimmed)) {
          flush(); currentRole = "assistant";
        } else if (USER_INLINE.test(trimmed)) {
          flush(); currentRole = "user";
          currentContent = [trimmed.replace(/^[^:]+:\s*/i, "")];
        } else if (ASST_INLINE.test(trimmed)) {
          flush(); currentRole = "assistant";
          currentContent = [trimmed.replace(/^[^:]+:\s*/i, "")];
        } else if (currentRole !== null) {
          currentContent.push(line);
        }
      }
      flush();
    }

    if (parsedMessages.length === 0) {
      res.status(400).json({ error: "Could not parse any messages from the provided text" });
      return;
    }

    const inserted = await db
      .insert(messagesTable)
      .values(
        parsedMessages.map((m) => ({
          threadId: params.data.threadId,
          role: m.role,
          content: m.content,
          isSummary: false,
        })),
      )
      .returning();

    await db
      .update(threadsTable)
      .set({ messageCount: thread.messageCount + inserted.length, lastMessageAt: new Date() })
      .where(eq(threadsTable.id, params.data.threadId));

    res.json({ importedCount: inserted.length, messages: inserted });

    // ── Async: embed imported messages (best-effort) ───────────────────────
    if (thread.profileId) {
      const [profile] = await db
        .select({ apiKey: profilesTable.apiKey })
        .from(profilesTable)
        .where(eq(profilesTable.id, thread.profileId));
      if (profile?.apiKey) {
        for (const msg of inserted) {
          if (msg.role === "user" || msg.role === "assistant") {
            embedMessageAsync(msg.id, params.data.threadId, thread.profileId, msg.content, profile.apiKey);
          }
        }
      }
    }
  } catch (err) {
    req.log.error({ err }, "Failed to import messages");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
