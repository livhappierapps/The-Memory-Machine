import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import JSZip from "jszip";
import fs from "node:fs/promises";
import { db } from "@workspace/db";
import { threadsTable, messagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./threads";

const router: IRouter = Router();

// ─── Multer setup ─────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.diskStorage({
    destination: "/tmp",
    filename: (_req, _file, cb) => cb(null, `grok-import-${Date.now()}.zip`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
  fileFilter: (_req, file, cb) => {
    // Accept if the filename ends in .zip OR the MIME type is any zip variant
    const isZipMime = [
      "application/zip",
      "application/x-zip",
      "application/x-zip-compressed",
      "application/octet-stream",
      "multipart/x-zip",
    ].includes(file.mimetype);
    const isZipName = file.originalname.toLowerCase().endsWith(".zip");
    if (isZipMime || isZipName) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Please upload a .zip file.`));
    }
  },
});

// ─── Multer error handler (must have 4 args for Express to treat as error middleware) ─
function multerErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const msg = err instanceof Error ? err.message : "File upload failed.";
  res.status(400).json({ error: msg });
}

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
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") {
          return (p as any).text ?? (p as any).content ?? (p as any).value ?? "";
        }
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object") {
    const c = content as any;
    // {parts: [...]} pattern
    if (Array.isArray(c.parts)) return c.parts.map(extractText).join("");
    return c.text ?? c.value ?? c.content ?? "";
  }
  return String(content ?? "");
}

function normalizeTs(ts: unknown): Date | undefined {
  if (!ts) return undefined;
  if (ts instanceof Date) return ts;
  if (typeof ts === "number") {
    // Unix seconds → ms
    return new Date(ts < 1e12 ? ts * 1000 : ts);
  }
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  return undefined;
}

function parseRole(role: unknown): "user" | "assistant" | null {
  if (typeof role !== "string") return null;
  const r = role.toLowerCase().trim();
  if (r === "user" || r === "human") return "user";
  if (r === "assistant" || r === "grok" || r === "ai" || r === "system") return "assistant";
  return null;
}

function parseConversationObject(obj: unknown): ParsedConversation | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  // ── Find message list ──────────────────────────────────────────────────────
  let rawMessages: unknown[] = [];

  if (Array.isArray(o.messages)) {
    rawMessages = o.messages;
  } else if (Array.isArray(o.turns)) {
    rawMessages = o.turns;                     // Grok alternate key
  } else if (Array.isArray(o.conversation)) {
    rawMessages = o.conversation;
  } else if (Array.isArray(o.history)) {
    rawMessages = o.history;
  } else if (o.mapping && typeof o.mapping === "object") {
    // OpenAI mapping format: keyed by id
    rawMessages = Object.values(o.mapping as Record<string, unknown>);
  }

  const messages: ParsedMessage[] = [];

  for (const m of rawMessages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, unknown>;

    // Mapping format has a nested .message
    const inner =
      msg.message && typeof msg.message === "object"
        ? (msg.message as Record<string, unknown>)
        : msg;

    // Role detection — may be a string or { role: string } or { author: { role: string } }
    let roleRaw: unknown = inner.role ?? inner.author;
    if (roleRaw && typeof roleRaw === "object" && (roleRaw as any).role) {
      roleRaw = (roleRaw as any).role;
    }
    const role = parseRole(roleRaw);
    if (!role) continue;

    // Content extraction
    let content = "";
    const raw = inner.content ?? inner.text ?? inner.value ?? inner.parts;
    if (inner.content && typeof inner.content === "object") {
      const c = inner.content as any;
      if (Array.isArray(c.parts)) {
        content = c.parts.map(extractText).join("");
      } else {
        content = extractText(inner.content);
      }
    } else {
      content = extractText(raw);
    }

    if (!content.trim()) continue;

    const ts = inner.create_time ?? inner.created_at ?? inner.timestamp ?? inner.time;
    messages.push({ role, content: content.trim(), createdAt: normalizeTs(ts) });
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
    typeof o.subject === "string" ? o.subject :
    "Imported conversation";

  const ts = o.create_time ?? o.created_at ?? o.createdAt ?? o.timestamp;

  return {
    title: title.slice(0, 255) || "Imported conversation",
    messages,
    createdAt: normalizeTs(ts),
  };
}

function parseFileContents(text: string): { conversations: ParsedConversation[]; debug: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { conversations: [], debug: "not valid JSON" };
  }

  // 1. Top-level array
  if (Array.isArray(json)) {
    if (json.length === 0) return { conversations: [], debug: "top-level array is empty" };
    // Check if it's an array of conversations or an array of messages
    const first = json[0] as Record<string, unknown>;
    const hasMessageKey =
      Array.isArray(first?.messages) ||
      Array.isArray(first?.turns) ||
      Array.isArray(first?.conversation) ||
      first?.mapping;
    if (hasMessageKey) {
      // Array of conversation objects
      const results: ParsedConversation[] = [];
      for (const item of json) {
        const parsed = parseConversationObject(item);
        if (parsed) results.push(parsed);
      }
      return { conversations: results, debug: `top-level array of ${json.length} items → ${results.length} conversations` };
    }
    // Maybe it IS the message array itself (single conversation)
    const roleKey = first?.role ?? first?.author;
    if (roleKey) {
      const parsed = parseConversationObject({ messages: json });
      if (parsed) return { conversations: [parsed], debug: `top-level message array → 1 conversation` };
    }
    return { conversations: [], debug: `top-level array of ${json.length} items but no known structure` };
  }

  // 2. Single conversation object
  const single = parseConversationObject(json);
  if (single) return { conversations: [single], debug: "single conversation object" };

  // 3. Container object — look for known array keys
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const key of ["conversations", "chats", "data", "history", "items", "results", "threads"]) {
      if (Array.isArray(o[key])) {
        const results: ParsedConversation[] = [];
        for (const item of o[key] as unknown[]) {
          const parsed = parseConversationObject(item);
          if (parsed) results.push(parsed);
        }
        if (results.length > 0) {
          return { conversations: results, debug: `container.${key}[${(o[key] as unknown[]).length}] → ${results.length} conversations` };
        }
      }
    }
    // Log the top-level keys so we can see the actual structure
    const keys = Object.keys(o).join(", ");
    return { conversations: [], debug: `object with keys: ${keys}` };
  }

  return { conversations: [], debug: `unexpected root type: ${typeof json}` };
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.post(
  "/import/zip",
  requireAuth,
  upload.single("file"),
  multerErrorHandler,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;

    if (!req.file) {
      res.status(400).json({ error: "No file received. Ensure the form field is named 'file' and the file is a .zip." });
      return;
    }

    // ── Switch to SSE ─────────────────────────────────────────────────────────
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (data: unknown) => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        // Force flush for Node's http module
        (res as any).flush?.();
      } catch {
        // client disconnected
      }
    };

    const filePath = req.file.path;

    try {
      send({ type: "status", message: "Reading ZIP file…" });

      let zipBuffer: Buffer;
      try {
        zipBuffer = await fs.readFile(filePath);
      } catch (readErr) {
        send({ type: "error", message: `Could not read uploaded file: ${(readErr as Error).message}` });
        res.end();
        return;
      }

      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(zipBuffer);
      } catch (zipErr) {
        send({ type: "error", message: `Not a valid ZIP file: ${(zipErr as Error).message}` });
        res.end();
        return;
      }

      // List all files in the ZIP (including subdirectories)
      const allFiles = Object.entries(zip.files);
      const jsonFiles = allFiles.filter(([, f]) => !f.dir && f.name.toLowerCase().endsWith(".json"));
      const totalFiles = allFiles.filter(([, f]) => !f.dir).length;

      send({
        type: "status",
        message: `ZIP contains ${totalFiles} file(s) — scanning ${jsonFiles.length} JSON file(s)…`,
      });

      if (jsonFiles.length === 0) {
        send({
          type: "error",
          message: `No JSON files found in the ZIP. Found these files: ${allFiles.filter(([, f]) => !f.dir).map(([n]) => n).join(", ") || "none"}`,
        });
        res.end();
        return;
      }

      // Parse all JSON files
      const allConversations: ParsedConversation[] = [];
      const debugLines: string[] = [];

      for (const [name, file] of jsonFiles) {
        let text: string;
        try {
          text = await file.async("string");
        } catch {
          debugLines.push(`${name}: could not read`);
          continue;
        }

        const { conversations, debug } = parseFileContents(text);
        debugLines.push(`${name}: ${debug}`);
        allConversations.push(...conversations);

        // Send a status update per file so the user can see progress
        if (jsonFiles.length > 1) {
          send({ type: "status", message: `Parsed ${name} → ${conversations.length} conversation(s)` });
        }
      }

      req.log.info({ debugLines, total: allConversations.length }, "ZIP import parsed");

      if (allConversations.length === 0) {
        send({
          type: "error",
          message: `No conversations could be parsed. Debug info: ${debugLines.join(" | ")}. Please share this message to get format support added.`,
        });
        res.end();
        return;
      }

      send({ type: "total", total: allConversations.length });

      let imported = 0;
      let failed = 0;

      for (const convo of allConversations) {
        try {
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

          if (convo.messages.length > 0) {
            await db.insert(messagesTable).values(
              convo.messages.map((m, i) => ({
                threadId: thread.id,
                role: m.role,
                content: m.content,
                isSummary: false,
                // Preserve original timestamps; add a small offset to maintain order
                createdAt: m.createdAt ?? new Date(Date.now() + i),
              })),
            );

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
          send({
            type: "progress",
            done: imported,
            total: allConversations.length,
            title: convo.title,
          });
        } catch (err) {
          failed++;
          req.log.error({ err, title: convo.title }, "Failed to import conversation");
        }
      }

      send({ type: "done", imported, failed });
    } catch (err) {
      req.log.error({ err }, "Bulk import unexpected error");
      send({ type: "error", message: `Unexpected error: ${(err as Error)?.message ?? "unknown"}` });
    } finally {
      res.end();
      await fs.unlink(filePath).catch(() => {});
    }
  },
);

export default router;
