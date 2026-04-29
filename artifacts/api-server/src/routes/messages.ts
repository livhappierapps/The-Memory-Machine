import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { threadsTable, messagesTable, settingsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import {
  GetThreadMessagesParams,
  SendMessageParams,
  SendMessageBody,
  ImportMessagesParams,
  ImportMessagesBody,
  StreamMessageParams,
  StreamMessageBody,
} from "@workspace/api-zod";
import { requireAuth } from "./threads";

const router: IRouter = Router();

const GROK_MAX_TOKENS = 131072;

// Get messages for a thread
router.get("/threads/:threadId/messages", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
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
    const userId = (req as any).userId;
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
  } catch (err) {
    req.log.error({ err }, "Failed to save message");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Stream Grok response via SSE
router.post("/threads/:threadId/stream", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
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

    // Get settings (API key)
    const [settings] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.userId, userId));

    const apiKey = settings?.apiKey;
    if (!apiKey) {
      res.status(400).json({ error: "No API key configured. Please add your Grok API key in Settings." });
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

    // Load full history
    const history = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.threadId, params.data.threadId))
      .orderBy(asc(messagesTable.createdAt));

    // Build messages array for Grok API
    const model = thread.model || settings?.defaultModel || "grok-3";
    const grokMessages = history.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send user message saved event
    sendEvent({ type: "user_message", message: userMsg });

    // Call Grok API with streaming
    let fullContent = "";
    try {
      const grokRes = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: grokMessages,
          stream: true,
        }),
      });

      if (!grokRes.ok) {
        const errorText = await grokRes.text();
        req.log.error({ status: grokRes.status, errorText }, "Grok API error");
        sendEvent({ type: "error", error: `Grok API error: ${grokRes.status} ${errorText}` });
        res.end();
        return;
      }

      const reader = grokRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const chunk = JSON.parse(data);
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                sendEvent({ type: "token", content: delta });
              }
            } catch {
              // skip malformed chunks
            }
          }
        }
      }
    } catch (fetchErr) {
      req.log.error({ fetchErr }, "Grok fetch error");
      sendEvent({ type: "error", error: "Failed to connect to Grok API" });
      res.end();
      return;
    }

    // Save assistant response
    const [assistantMsg] = await db
      .insert(messagesTable)
      .values({
        threadId: params.data.threadId,
        role: "assistant",
        content: fullContent,
        isSummary: false,
      })
      .returning();

    // Update thread message count
    await db
      .update(threadsTable)
      .set({ messageCount: thread.messageCount + 2, lastMessageAt: new Date() })
      .where(eq(threadsTable.id, params.data.threadId));

    sendEvent({ type: "done", message: assistantMsg });
    res.end();
  } catch (err) {
    req.log.error({ err }, "Stream error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else {
      res.end();
    }
  }
});

// Import messages
router.post("/threads/:threadId/import", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
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

    // Try JSON parse first
    if (format === "json" || format === "auto") {
      try {
        const json = JSON.parse(raw);
        if (Array.isArray(json)) {
          parsedMessages = json.filter(
            (m) =>
              m &&
              typeof m.role === "string" &&
              typeof m.content === "string" &&
              ["user", "assistant", "system"].includes(m.role),
          );
        } else if (json.messages && Array.isArray(json.messages)) {
          parsedMessages = json.messages.filter(
            (m: unknown) =>
              m &&
              typeof (m as any).role === "string" &&
              typeof (m as any).content === "string" &&
              ["user", "assistant", "system"].includes((m as any).role),
          );
        }
      } catch {
        // not JSON, fall through
      }
    }

    // Text parsing if JSON didn't work
    if (parsedMessages.length === 0 && (format === "text" || format === "auto")) {
      const lines = raw.split("\n");
      let currentRole: "user" | "assistant" | null = null;
      let currentContent: string[] = [];

      const flushCurrent = () => {
        if (currentRole && currentContent.length > 0) {
          parsedMessages.push({ role: currentRole, content: currentContent.join("\n").trim() });
          currentContent = [];
        }
      };

      for (const line of lines) {
        const lower = line.toLowerCase().trim();
        if (lower.startsWith("you:") || lower.startsWith("human:") || lower.startsWith("user:")) {
          flushCurrent();
          currentRole = "user";
          currentContent = [line.replace(/^[^:]+:\s*/i, "")];
        } else if (
          lower.startsWith("grok:") ||
          lower.startsWith("assistant:") ||
          lower.startsWith("ai:")
        ) {
          flushCurrent();
          currentRole = "assistant";
          currentContent = [line.replace(/^[^:]+:\s*/i, "")];
        } else if (currentRole) {
          currentContent.push(line);
        }
      }
      flushCurrent();
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
  } catch (err) {
    req.log.error({ err }, "Failed to import messages");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
