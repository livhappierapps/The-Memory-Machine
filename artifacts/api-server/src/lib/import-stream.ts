/**
 * import-stream.ts
 *
 * Server-side conversation import. Accepts a file path (ZIP or JSON),
 * extracts / parses conversations, and inserts them into the database
 * in batches while calling `onEvent` with live progress updates.
 *
 * Keeping all heavy lifting on the server means any device (even a
 * low-memory phone) can import a large Grok export — the browser only
 * needs to upload the file.
 */

import fs from "fs";
import JSZip from "jszip";
import { db } from "@workspace/db";
import { threadsTable, messagesTable } from "@workspace/db";
import { logger } from "./logger";
import { embedMessageAsync } from "./embeddings";
import { encryptField } from "./field-crypto";

// ── Event types ───────────────────────────────────────────────────────────────

export type ImportEvent =
  | { type: "progress"; processed: number; imported: number; skipped: number }
  | { type: "done"; imported: number; skipped: number; errors: number }
  | { type: "error"; message: string };

// ── Conversation parsing ──────────────────────────────────────────────────────
// Mirrors the logic in the browser's lib/parse-zip.ts so both paths
// support the same export formats.

function toRole(r: unknown): "user" | "assistant" | null {
  if (typeof r !== "string") return null;
  const s = r.toLowerCase().trim();
  if (s === "user" || s === "human") return "user";
  if (
    s === "assistant" ||
    s === "grok" ||
    s === "ai" ||
    s === "bot" ||
    s === "model" ||
    s === "system" ||
    s === "claude" ||
    s === "chatgpt" ||
    s === "gemini"
  )
    return "assistant";
  return null;
}

function extractText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return (v as unknown[]).map(extractText).join(" ").trim();
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Common text field names across different exporters
    for (const k of ["text", "value", "content", "body", "response", "transcription", "caption", "description"]) {
      if (typeof o[k] === "string" && (o[k] as string).trim()) return o[k] as string;
    }
    if (Array.isArray(o.parts)) return (o.parts as unknown[]).map(extractText).join("").trim();
    if (Array.isArray(o.children)) return (o.children as unknown[]).map(extractText).join("").trim();
  }
  return "";
}

/** Describe an attachments array when there is no readable text content */
function attachmentLabel(attachments: unknown): string {
  if (!Array.isArray(attachments) || attachments.length === 0) return "";
  const labels = (attachments as unknown[]).map((a) => {
    if (!a || typeof a !== "object") return "Attachment";
    const at = a as Record<string, unknown>;
    const type = String(at.type ?? at.mimeType ?? at.mediaType ?? "attachment").toLowerCase();
    if (type.includes("image") || type.includes("photo") || type.includes("jpg") || type.includes("png"))
      return "[Image]";
    if (type.includes("video")) return "[Video]";
    if (type.includes("audio") || type.includes("voice")) return "[Audio]";
    if (type.includes("pdf") || type.includes("doc") || type.includes("file")) {
      const name = String(at.name ?? at.fileName ?? at.filename ?? "File");
      return `[File: ${name}]`;
    }
    return "[Attachment]";
  });
  return labels.join(" ");
}

interface ParsedMessage {
  role: "user" | "assistant";
  content: string;
}

interface ParsedConversation {
  title: string;
  messages: ParsedMessage[];
}

function tryExtractMessages(raws: unknown[]): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const m of raws) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, unknown>;

    // When msg.message is an object, treat it as the inner payload;
    // when msg.response is an object (Grok's wrapped export format), unwrap it;
    // otherwise fall back to msg itself (covers Grok's flat structure)
    const inner =
      msg.message && typeof msg.message === "object"
        ? (msg.message as Record<string, unknown>)
        : msg.response && typeof msg.response === "object"
        ? (msg.response as Record<string, unknown>)
        : msg;

    // Role — try every field name different exporters use
    let roleRaw: unknown =
      inner.role ?? inner.author ?? inner.sender ?? msg.sender ?? msg.role ?? msg.author;
    if (roleRaw && typeof roleRaw === "object" && (roleRaw as Record<string, unknown>).role)
      roleRaw = (roleRaw as Record<string, unknown>).role;

    const role = toRole(roleRaw);
    if (!role) continue;

    // Content — try every field name different exporters use
    let content = "";
    if (inner.content && typeof inner.content === "object") {
      const ct = inner.content as Record<string, unknown>;
      content = Array.isArray(ct.parts)
        ? (ct.parts as unknown[]).map(extractText).join("")
        : extractText(ct);
    } else {
      const rawContent =
        inner.content ??
        inner.text ??
        inner.value ??
        inner.body ??
        inner.response ??
        inner.message ??
        (typeof msg.message === "string" ? msg.message : undefined) ??
        msg.transcription ??
        msg.audioTranscription ??
        msg.audio_transcription ??
        inner.transcription ??
        inner.audioTranscription ??
        (msg.responseData && typeof msg.responseData === "object"
          ? (msg.responseData as Record<string, unknown>).text
          : undefined) ??
        (msg.userMedia && typeof msg.userMedia === "object"
          ? (msg.userMedia as Record<string, unknown>).transcription
          : undefined);
      content = extractText(rawContent);
    }

    // Fallback 1: attachment labels
    if (!content.trim()) {
      const attachments = msg.attachments ?? inner.attachments ?? msg.files ?? inner.files;
      content = attachmentLabel(attachments);
    }

    // Fallback 2: audio/voice placeholder
    if (!content.trim()) {
      const hasAudio =
        msg.audio != null ||
        msg.audioData != null ||
        inner.audio != null ||
        msg.isAudio === true ||
        msg.messageType === "audio" ||
        inner.messageType === "audio" ||
        String(msg.type ?? inner.type ?? "").toLowerCase().includes("audio") ||
        String(msg.type ?? inner.type ?? "").toLowerCase().includes("voice");
      if (hasAudio) content = "[Voice message]";
    }

    if (content.trim()) messages.push({ role, content: content.trim() });
  }

  return messages;
}

function parseConversationItem(o: unknown): ParsedConversation | null {
  if (!o || typeof o !== "object") return null;
  const c = o as Record<string, unknown>;

  // ── Step 1: locate the message list ────────────────────────────────────────
  // Try known key names first, then fall back to scanning every array-valued
  // key in the object (handles unknown / future Grok export formats).
  let raws: unknown[] = [];
  let foundKey = "";

  const knownKeys = ["messages", "turns", "conversation", "history", "responses", "exchanges", "items", "entries", "chat", "dialogue", "thread"];
  for (const key of knownKeys) {
    if (Array.isArray(c[key]) && (c[key] as unknown[]).length > 0) {
      raws = c[key] as unknown[];
      foundKey = key;
      break;
    }
  }

  // mapping is a special object-of-objects format (ChatGPT style)
  if (raws.length === 0 && c.mapping && typeof c.mapping === "object") {
    raws = Object.values(c.mapping as Record<string, unknown>);
    foundKey = "mapping";
  }

  // Last resort: scan every key for a non-empty array and try to parse messages from it
  if (raws.length === 0) {
    for (const [key, val] of Object.entries(c)) {
      if (Array.isArray(val) && val.length > 0) {
        const candidate = tryExtractMessages(val as unknown[]);
        if (candidate.length > 0) {
          raws = val as unknown[];
          foundKey = key;
          break;
        }
      }
    }
  }

  if (foundKey) {
    logger.debug({ foundKey, rawCount: raws.length }, "Import: found message array");
  }

  const messages = tryExtractMessages(raws);

  if (messages.length === 0) {
    // Log the raw structure of the first message so we can see unknown formats
    const sample = raws[0] !== undefined ? JSON.stringify(raws[0]).slice(0, 500) : "(empty)";
    logger.warn(
      { convKeys: Object.keys(c), foundKey, rawCount: raws.length, sampleRaw: sample },
      "Conversation skipped — no parseable messages",
    );
    return null;
  }

  // Title — try every common field; fall back to first user message snippet
  const titleRaw =
    (typeof c.title === "string" && c.title) ||
    (typeof c.name === "string" && c.name) ||
    (typeof c.subject === "string" && c.subject) ||
    (typeof c.conversationTitle === "string" && c.conversationTitle) ||
    messages.find((m) => m.role === "user")?.content.slice(0, 80) ||
    "Imported conversation";

  return {
    title: (titleRaw as string).slice(0, 255) || "Imported conversation",
    messages,
  };
}

/** Pull the conversations array out of any top-level JSON shape. */
function extractConversations(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;

  const candidates = ["conversations", "chats", "messages", "data", "history", "items"];
  for (const key of candidates) {
    if (Array.isArray(o[key]) && (o[key] as unknown[]).length > 0) return o[key] as unknown[];
  }
  // Fall back to the first non-empty array value
  for (const val of Object.values(o)) {
    if (Array.isArray(val) && (val as unknown[]).length > 0) return val as unknown[];
  }
  return [];
}

// ── Batch DB insert ───────────────────────────────────────────────────────────

const BATCH_SIZE = 20;
// Postgres hard limit is 65 535 parameters; each message row uses 4 fields
const MAX_MSG_ROWS_PER_QUERY = Math.floor(60_000 / 4);

async function insertBatch(
  userId: string,
  batch: ParsedConversation[],
  profileId: number | null = null,
  apiKey?: string,
  embeddingProvider = "xai",
): Promise<void> {
  if (batch.length === 0) return;

  const threads = await db
    .insert(threadsTable)
    .values(
      batch.map((c) => ({
        userId,
        title: c.title,
        model: "grok-3" as const,
        profileId: profileId ?? undefined,
        messageCount: c.messages.length,
      })),
    )
    .returning();

  // Keep plaintext content separately — needed for embedding (before encryption)
  const allMessagesPlain: string[] = [];
  const allMessages = threads.flatMap((thread, i) =>
    (batch[i]?.messages ?? []).map((m) => {
      allMessagesPlain.push(m.content);
      return {
        threadId: thread.id,
        role: m.role,
        content: encryptField(userId, m.content),
        isSummary: false,
      };
    }),
  );

  // Chunk to stay under the PG parameter limit
  const insertedMessages: Array<typeof messagesTable.$inferSelect> = [];
  for (let i = 0; i < allMessages.length; i += MAX_MSG_ROWS_PER_QUERY) {
    const chunk = await db
      .insert(messagesTable)
      .values(allMessages.slice(i, i + MAX_MSG_ROWS_PER_QUERY))
      .returning();
    insertedMessages.push(...chunk);
  }

  // Fire-and-forget: generate embeddings for all inserted messages so that
  // smart memory retrieval works on imported conversations.
  // Embedding is skipped gracefully when apiKey is absent.
  // Use plaintext content (allMessagesPlain[i]) not the encrypted DB form.
  if (apiKey) {
    for (let i = 0; i < insertedMessages.length; i++) {
      const msg = insertedMessages[i]!;
      // Only embed user/assistant turns (skip any system messages)
      if (msg.role === "user" || msg.role === "assistant") {
        const plain = allMessagesPlain[i] ?? "";
        embedMessageAsync(msg.id, msg.threadId, profileId, plain, apiKey, embeddingProvider);
      }
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function streamImportFile(
  filePath: string,
  isZip: boolean,
  userId: string,
  onEvent: (event: ImportEvent) => void,
  opts?: { profileId?: number | null; apiKey?: string; embeddingProvider?: string },
): Promise<void> {
  // ── 1. Read & extract ───────────────────────────────────────────────────
  let jsonText: string;

  if (isZip) {
    const zipData = await fs.promises.readFile(filePath);
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(zipData);
    } catch {
      onEvent({ type: "error", message: "Could not open the ZIP file. It may be corrupted." });
      return;
    }

    const allEntries = Object.entries(zip.files);
    const jsonEntries = allEntries.filter(
      ([name, f]) => !f.dir && name.toLowerCase().endsWith(".json"),
    );

    if (jsonEntries.length === 0) {
      onEvent({ type: "error", message: "No JSON files found inside the ZIP archive." });
      return;
    }

    // Prefer the known Grok backend export; otherwise take the first JSON entry
    const [bestName, bestEntry] =
      jsonEntries.find(([name]) => name.toLowerCase().includes("grok-backend")) ??
      jsonEntries.find(([name]) => name.toLowerCase().includes("conversation")) ??
      jsonEntries[0];

    logger.info({ selectedFile: bestName, totalJsonFiles: jsonEntries.length }, "Import: selected JSON file");

    jsonText = await bestEntry.async("string");
  } else {
    jsonText = await fs.promises.readFile(filePath, "utf8");
  }

  // ── 2. Parse JSON ───────────────────────────────────────────────────────
  let json: unknown;
  try {
    json = JSON.parse(jsonText);
  } catch {
    onEvent({ type: "error", message: "The file does not contain valid JSON." });
    return;
  }
  // Release the raw string as soon as possible
  (jsonText as unknown) = null;

  const rawConversations = extractConversations(json);
  (json as unknown) = null;

  if (rawConversations.length === 0) {
    onEvent({
      type: "error",
      message:
        "No conversations found in this file. " +
        "Make sure you are using a Grok export ZIP or a conversations JSON file.",
    });
    return;
  }

  logger.info({ count: rawConversations.length }, "Import: conversations found");

  // ── 3. Parse + batch-insert ─────────────────────────────────────────────
  let processed = 0;
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let batch: ParsedConversation[] = [];

  const { profileId = null, apiKey, embeddingProvider = "xai" } = opts ?? {};

  const flush = async () => {
    if (batch.length === 0) return;
    try {
      await insertBatch(userId, batch, profileId, apiKey, embeddingProvider);
      imported += batch.length;
    } catch (err) {
      logger.error({ err }, "Batch insert failed during import");
      errors += batch.length;
    }
    batch = [];
  };

  for (const raw of rawConversations) {
    processed++;
    const conv = parseConversationItem(raw);
    if (!conv) {
      skipped++;
      continue;
    }

    batch.push(conv);

    if (batch.length >= BATCH_SIZE) {
      await flush();
      onEvent({ type: "progress", processed, imported, skipped });
    }
  }

  await flush();
  onEvent({ type: "done", imported, skipped, errors });
}
