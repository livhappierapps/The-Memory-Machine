import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { threadsTable, messagesTable, settingsTable, profilesTable } from "@workspace/db";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { z } from "zod/v4";
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
import { streamCompletion, resolveChatKey, type ChatProvider } from "../lib/ai-provider";
import { embedMessageAsync } from "../lib/embeddings";
import { retrieveMemories } from "../lib/memory";
import { maybeSummarizeAsync } from "../lib/summarizer";

const router: IRouter = Router();

const RecentMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(40),
});

// GET /messages/recent — flat cross-thread history for 2WAI session-start context
router.get("/messages/recent", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const parsed = RecentMessagesQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters" });
      return;
    }
    const { limit } = parsed.data;

    const userThreads = await db
      .select({ id: threadsTable.id })
      .from(threadsTable)
      .where(eq(threadsTable.userId, userId));

    if (userThreads.length === 0) {
      res.json([]);
      return;
    }

    const threadIds = userThreads.map((t) => t.id);

    const messages = await db
      .select()
      .from(messagesTable)
      .where(and(inArray(messagesTable.threadId, threadIds), eq(messagesTable.isSummary, false)))
      .orderBy(desc(messagesTable.createdAt))
      .limit(limit);

    res.json(messages);
  } catch (err) {
    req.log.error({ err }, "Failed to get recent messages");
    res.status(500).json({ error: "Internal server error" });
  }
});

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

    // Exclude isSummary=true rows — summaries are internal memory artifacts,
    // not conversation turns that the user should see or that should be sent
    // back into the thread context.
    const messages = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.threadId, params.data.threadId), eq(messagesTable.isSummary, false)))
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
        .select({ apiKey: profilesTable.apiKey, embeddingProvider: profilesTable.embeddingProvider, openAiApiKey: profilesTable.openAiApiKey })
        .from(profilesTable)
        .where(eq(profilesTable.id, thread.profileId));
      // Resolve the effective embedding key: prefer openAiApiKey for openai provider,
      // fall back to profile.apiKey. Only skip embedding if no key of any kind is available.
      const provider = profile?.embeddingProvider ?? "xai";
      const embKey = (provider === "openai" ? profile?.openAiApiKey : null) ?? profile?.apiKey;
      if (embKey) {
        embedMessageAsync(message.id, params.data.threadId, thread.profileId, parsed.data.content, embKey, provider);
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

    // Save user message first — before any API key check so the message is
    // always persisted and visible in the UI even when streaming cannot start.
    const [userMsg] = await db
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

    // Determine which AI provider and key to use for this chat request
    const chatProvider = (profile?.chatProvider ?? "xai") as ChatProvider;
    const apiKey = resolveChatKey(
      chatProvider,
      profile?.apiKey ?? settings?.apiKey ?? null,
      profile?.openAiApiKey ?? null,
      profile?.anthropicApiKey ?? null,
      profile?.googleApiKey ?? null,
    );
    if (!apiKey) {
      const providerLabels: Record<ChatProvider, string> = {
        xai: "Grok (xAI) API key (xai-…)",
        openai: "OpenAI API key (sk-…)",
        anthropic: "Anthropic API key (sk-ant-…)",
        google: "Google Gemini API key (AIza…)",
      };
      // Switch to SSE mode so the frontend receives the user_message event
      // and can show the chat bubble before displaying the error.
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ type: "user_message", message: userMsg })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "error", error: `No API key configured for ${providerLabels[chatProvider]}. Add it in Settings → AI Provider.` })}\n\n`);
      res.end();
      return;
    }

    // Load current thread history — exclude summary messages (they are internal
    // memory artifacts and must not be sent back as conversation turns to Grok)
    const history = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.threadId, params.data.threadId), eq(messagesTable.isSummary, false)))
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
        // Resolve the key to use for embedding the query (may differ from chat key)
        const embeddingProvider = profile.embeddingProvider ?? "xai";
        const resolvedOpenAiKey = embeddingProvider === "openai" ? profile.openAiApiKey : null;
        if (embeddingProvider === "openai" && !resolvedOpenAiKey) {
          req.log.warn(
            { profileId: profile.id },
            "embeddingProvider=openai but no openAiApiKey configured — semantic retrieval will fall back to Grok key against OpenAI endpoint and likely fail; auto-falling back to xAI provider for this request",
          );
        }
        // For xAI embeddings, use profile.apiKey (the dedicated xAI key),
        // not the chat key (which may be Anthropic/Google for this profile).
        const embeddingApiKey = resolvedOpenAiKey ?? profile.apiKey ?? settings?.apiKey ?? "";
        const effectiveProvider = embeddingProvider === "openai" && !resolvedOpenAiKey ? "xai" : embeddingProvider;
        if (!embeddingApiKey) {
          req.log.warn({ profileId: profile.id, embeddingProvider }, "No embedding API key — skipping smart retrieval");
          throw new Error("no-embedding-key");
        }

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
          apiKey: embeddingApiKey,
          embeddingProvider: effectiveProvider,
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
    let historyToSend = maxCtx > 0 ? history.slice(-maxCtx) : history;

    // ── Global context-window budget ──────────────────────────────────────
    // Grok-3 has a ~131k token window. At ~4 chars/token that's ~524k chars.
    // We reserve ~100k for the response and overhead, leaving 400k for the
    // assembled prompt. If the combined content (personality + memories +
    // thread history) exceeds the budget, trim the oldest thread messages
    // first — but always keep the most recent user message.
    const GLOBAL_CHAR_BUDGET = 400_000;
    const fixedChars = grokMessages.reduce((sum, m) => sum + m.content.length, 0);

    if (fixedChars < GLOBAL_CHAR_BUDGET) {
      const historyBudget = GLOBAL_CHAR_BUDGET - fixedChars;
      let usedChars = 0;
      // Walk from newest → oldest, keep as many messages as fit the budget
      const fittingHistory: typeof historyToSend = [];
      for (let i = historyToSend.length - 1; i >= 0; i--) {
        const msgLen = historyToSend[i]!.content.length;
        if (usedChars + msgLen > historyBudget && fittingHistory.length > 0) break;
        fittingHistory.unshift(historyToSend[i]!);
        usedChars += msgLen;
      }
      if (fittingHistory.length < historyToSend.length) {
        req.log.warn(
          { originalCount: historyToSend.length, trimmedCount: fittingHistory.length },
          "Thread history trimmed to fit global context budget",
        );
      }
      historyToSend = fittingHistory;
    }

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
    await streamCompletion(chatProvider, apiKey, model, grokMessages, {
      onToken: (delta) => {
        fullContent += delta;
        sendEvent({ type: "token", content: delta });
      },
      onError: (message) => {
        req.log.error({ message, provider: chatProvider }, "AI stream error");
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
    // Note: thread.messageCount was snapshotted before the user message was inserted
    // (the +1 update for the user message runs before the API key check). The +2 here
    // still refers to the original snapshot value, so the final count is correct:
    // snapshot + 2 overwrites snapshot + 1, giving the right absolute count.

    sendEvent({ type: "done", message: assistantMsg, memorySources });
    res.end();

    // ── Async: generate embeddings for user + assistant messages ──────────
    const embeddingProvider = profile?.embeddingProvider ?? "xai";
    // Embedding key is independent of chat provider:
    // openai embeddings → openAiApiKey; xai embeddings → profile.apiKey (xAI key), not the chat key.
    const embeddingKey =
      (embeddingProvider === "openai" ? profile?.openAiApiKey : null) ?? profile?.apiKey ?? settings?.apiKey ?? "";
    embedMessageAsync(userMsg.id, params.data.threadId, thread.profileId ?? null, parsed.data.content, embeddingKey, embeddingProvider);
    if (fullContent) {
      embedMessageAsync(assistantMsg.id, params.data.threadId, thread.profileId ?? null, fullContent, embeddingKey, embeddingProvider);
    }

    // ── Async: summarize thread if it has grown long enough ───────────────
    // Summarization always uses xAI (callGrokForSummary is xAI-only), so always
    // pass the xAI key explicitly — never the chat provider key (which may be
    // Anthropic/Google for this profile). Skip if no xAI key is configured.
    const xaiKeyForSummary = profile?.apiKey ?? settings?.apiKey;
    if (xaiKeyForSummary) {
      const summaryModel = chatProvider === "xai" ? model : (profile?.defaultModel ?? "grok-3-mini");
      maybeSummarizeAsync(params.data.threadId, xaiKeyForSummary, summaryModel);
    } else {
      req.log.debug({ chatProvider, threadId: params.data.threadId }, "Skipping summarization — no xAI key configured for this profile");
    }
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
        .select({ apiKey: profilesTable.apiKey, embeddingProvider: profilesTable.embeddingProvider, openAiApiKey: profilesTable.openAiApiKey })
        .from(profilesTable)
        .where(eq(profilesTable.id, thread.profileId));
      // Resolve effective embedding key (openAiApiKey for openai provider, else profile.apiKey)
      const provider = profile?.embeddingProvider ?? "xai";
      const embKey = (provider === "openai" ? profile?.openAiApiKey : null) ?? profile?.apiKey;
      if (embKey) {
        for (const msg of inserted) {
          if (msg.role === "user" || msg.role === "assistant") {
            embedMessageAsync(msg.id, params.data.threadId, thread.profileId, msg.content, embKey, provider);
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
