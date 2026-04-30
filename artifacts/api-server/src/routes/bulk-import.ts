import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import JSZip from "jszip";
import fs from "node:fs/promises";
import { db } from "@workspace/db";
import { threadsTable, messagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./threads";

const router: IRouter = Router();

// Disk storage — safer for large files (375MB+)
const upload = multer({
  storage: multer.diskStorage({
    destination: "/tmp",
    filename: (_req, _file, cb) => cb(null, `grok-import-${Date.now()}.zip`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/zip" || file.originalname.endsWith(".zip")) {
      cb(null, true);
    } else {
      cb(new Error("Only ZIP files are accepted"));
    }
  },
});

// ─── Conversation parsing helpers ─────────────────────────────────────────────

interface ParsedMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: Date;
}

interface ParsedConversation {
  title: string;
  messages: ParsedMessage[];
  createdAt?: Date;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  // Grok sometimes nests content as {type:"text", text:"..."} or array of parts
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") {
          return (p as any).text ?? (p as any).content ?? "";
        }
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object") {
    return (content as any).text ?? (content as any).value ?? "";
  }
  return String(content ?? "");
}

function parseConversationObject(obj: unknown): ParsedConversation | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  // Find the messages array — Grok uses "messages", some exports use "mapping"
  let rawMessages: unknown[] = [];
  if (Array.isArray(o.messages)) {
    rawMessages = o.messages;
  } else if (o.mapping && typeof o.mapping === "object") {
    // OpenAI / some Grok formats store messages as a mapping keyed by id
    rawMessages = Object.values(o.mapping as Record<string, unknown>);
  }

  const messages: ParsedMessage[] = [];
  for (const m of rawMessages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, unknown>;

    // Handle nested message object (mapping format)
    const inner = msg.message && typeof msg.message === "object"
      ? (msg.message as Record<string, unknown>)
      : msg;

    const role = (inner.role ?? inner.author) as string | undefined;
    if (!role || !["user", "assistant", "grok"].includes(role.toLowerCase())) continue;

    // Content might be in inner.content.parts[0] or inner.content directly
    let content = "";
    if (inner.content && typeof inner.content === "object" && Array.isArray((inner.content as any).parts)) {
      content = (inner.content as any).parts.map(extractText).join("");
    } else {
      content = extractText(inner.content ?? inner.text ?? inner.value);
    }

    if (!content.trim()) continue;

    const normalizedRole: "user" | "assistant" =
      role.toLowerCase() === "user" ? "user" : "assistant";

    const ts = inner.create_time ?? inner.created_at ?? inner.timestamp;
    messages.push({
      role: normalizedRole,
      content: content.trim(),
      createdAt: ts ? new Date(typeof ts === "number" && ts < 1e12 ? ts * 1000 : ts as any) : undefined,
    });
  }

  if (messages.length === 0) return null;

  // Sort by timestamp if available
  messages.sort((a, b) => {
    if (a.createdAt && b.createdAt) return a.createdAt.getTime() - b.createdAt.getTime();
    return 0;
  });

  const title =
    typeof o.title === "string" ? o.title :
    typeof o.name === "string" ? o.name :
    `Imported conversation`;

  const ts = o.create_time ?? o.created_at ?? o.createdAt;
  const createdAt = ts
    ? new Date(typeof ts === "number" && ts < 1e12 ? ts * 1000 : ts as any)
    : undefined;

  return { title: title.slice(0, 255) || "Imported conversation", messages, createdAt };
}

function parseFileContents(text: string): ParsedConversation[] {
  try {
    const json = JSON.parse(text);
    // Top-level array of conversations
    if (Array.isArray(json)) {
      const results: ParsedConversation[] = [];
      for (const item of json) {
        const parsed = parseConversationObject(item);
        if (parsed) results.push(parsed);
      }
      if (results.length > 0) return results;
    }
    // Top-level object that is a single conversation
    const single = parseConversationObject(json);
    if (single) return [single];
    // Object with a conversations / chats key
    for (const key of ["conversations", "chats", "data", "history"]) {
      if (Array.isArray((json as any)[key])) {
        const results: ParsedConversation[] = [];
        for (const item of (json as any)[key]) {
          const parsed = parseConversationObject(item);
          if (parsed) results.push(parsed);
        }
        if (results.length > 0) return results;
      }
    }
  } catch {
    // not JSON — ignore
  }
  return [];
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.post(
  "/import/zip",
  requireAuth,
  upload.single("file"),
  async (req: Request, res: Response) => {
    const userId = (req as any).userId;

    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    // Stream progress back via SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      send({ type: "status", message: "Reading ZIP file…" });

      const zipBuffer = await fs.readFile(req.file.path);
      const zip = await JSZip.loadAsync(zipBuffer);

      // Collect all JSON files
      const jsonFiles: { name: string; content: string }[] = [];
      const fileEntries = Object.entries(zip.files).filter(
        ([, f]) => !f.dir && f.name.endsWith(".json"),
      );

      send({ type: "status", message: `Found ${fileEntries.length} file(s) in ZIP — scanning…` });

      for (const [name, file] of fileEntries) {
        try {
          const text = await file.async("string");
          jsonFiles.push({ name, content: text });
        } catch {
          // skip unreadable files
        }
      }

      // Parse all conversations
      const allConversations: ParsedConversation[] = [];
      for (const { content } of jsonFiles) {
        const convos = parseFileContents(content);
        allConversations.push(...convos);
      }

      if (allConversations.length === 0) {
        send({ type: "error", message: "Couldn't find any conversations in the ZIP. The format may not be supported yet." });
        res.end();
        await fs.unlink(req.file.path).catch(() => {});
        return;
      }

      send({ type: "total", total: allConversations.length });

      let imported = 0;
      let failed = 0;

      for (const convo of allConversations) {
        try {
          // Create thread
          const [thread] = await db
            .insert(threadsTable)
            .values({
              userId,
              title: convo.title,
              model: "grok-3",
              archived: false,
              pinned: false,
              messageCount: 0,
              lastMessageAt: convo.createdAt ?? new Date(),
            })
            .returning();

          // Batch-insert messages
          if (convo.messages.length > 0) {
            await db.insert(messagesTable).values(
              convo.messages.map((m, i) => ({
                threadId: thread.id,
                role: m.role,
                content: m.content,
                isSummary: false,
                createdAt: m.createdAt ?? new Date(Date.now() + i),
              })),
            );

            // Update thread message count
            const lastMsg = convo.messages[convo.messages.length - 1];
            await db
              .update(threadsTable)
              .set({
                messageCount: convo.messages.length,
                lastMessageAt: lastMsg.createdAt ?? new Date(),
              })
              .where(eq(threadsTable.id, thread.id));
          }

          imported++;
          send({ type: "progress", done: imported, total: allConversations.length, title: convo.title });
        } catch (err) {
          failed++;
          req.log.error({ err, title: convo.title }, "Failed to import conversation");
        }
      }

      send({ type: "done", imported, failed });
    } catch (err) {
      req.log.error({ err }, "Bulk import error");
      send({ type: "error", message: "An unexpected error occurred while processing the ZIP." });
    } finally {
      res.end();
      await fs.unlink(req.file!.path).catch(() => {});
    }
  },
);

export default router;
