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
  if (s === "assistant" || s === "grok" || s === "ai" || s === "bot") return "assistant";
  return null;
}

function extractText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return (v as unknown[]).map(extractText).join("");
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.value === "string") return o.value;
    if (Array.isArray(o.parts)) return (o.parts as unknown[]).map(extractText).join("");
  }
  return "";
}

interface ParsedMessage {
  role: "user" | "assistant";
  content: string;
}

interface ParsedConversation {
  title: string;
  messages: ParsedMessage[];
}

function parseConversationItem(o: unknown): ParsedConversation | null {
  if (!o || typeof o !== "object") return null;
  const c = o as Record<string, unknown>;

  // Locate the message list under several common key names
  let raws: unknown[] = [];
  if (Array.isArray(c.messages)) raws = c.messages;
  else if (Array.isArray(c.turns)) raws = c.turns;
  else if (Array.isArray(c.conversation)) raws = c.conversation;
  else if (Array.isArray(c.history)) raws = c.history;
  else if (c.mapping && typeof c.mapping === "object")
    raws = Object.values(c.mapping as Record<string, unknown>);

  const messages: ParsedMessage[] = [];

  for (const m of raws) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, unknown>;

    const inner =
      msg.message && typeof msg.message === "object"
        ? (msg.message as Record<string, unknown>)
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
        inner.message ??
        (typeof msg.message === "string" ? msg.message : undefined);
      content = extractText(rawContent);
    }

    if (content.trim()) messages.push({ role, content: content.trim() });
  }

  if (messages.length === 0) return null;

  // Title — try every common field; fall back to first user message snippet
  const titleRaw =
    (typeof c.title === "string" && c.title) ||
    (typeof c.name === "string" && c.name) ||
    (typeof c.subject === "string" && c.subject) ||
    (typeof (c as Record<string, unknown>).conversationTitle === "string" &&
      (c as Record<string, unknown>).conversationTitle) ||
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

async function insertBatch(userId: string, batch: ParsedConversation[]): Promise<void> {
  if (batch.length === 0) return;

  const threads = await db
    .insert(threadsTable)
    .values(
      batch.map((c) => ({
        userId,
        title: c.title,
        model: "grok-3" as const,
        messageCount: c.messages.length,
      })),
    )
    .returning();

  const allMessages = threads.flatMap((thread, i) =>
    (batch[i]?.messages ?? []).map((m) => ({
      threadId: thread.id,
      role: m.role,
      content: m.content,
      isSummary: false,
    })),
  );

  // Chunk to stay under the PG parameter limit
  for (let i = 0; i < allMessages.length; i += MAX_MSG_ROWS_PER_QUERY) {
    await db.insert(messagesTable).values(allMessages.slice(i, i + MAX_MSG_ROWS_PER_QUERY));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function streamImportFile(
  filePath: string,
  isZip: boolean,
  userId: string,
  onEvent: (event: ImportEvent) => void,
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

    const jsonEntries = Object.entries(zip.files).filter(
      ([name, f]) => !f.dir && name.toLowerCase().endsWith(".json"),
    );

    if (jsonEntries.length === 0) {
      onEvent({ type: "error", message: "No JSON files found inside the ZIP archive." });
      return;
    }

    // Prefer the known Grok backend export; otherwise take the first JSON entry
    const [, bestEntry] =
      jsonEntries.find(([name]) => name.toLowerCase().includes("grok-backend")) ??
      jsonEntries.find(([name]) => name.toLowerCase().includes("conversation")) ??
      jsonEntries[0];

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

  // ── 3. Parse + batch-insert ─────────────────────────────────────────────
  let processed = 0;
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let batch: ParsedConversation[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    try {
      await insertBatch(userId, batch);
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
