/**
 * parse-zip.ts
 *
 * Browser-side parser for Grok export ZIP archives.
 * Extracts conversations from JSON files found inside the archive.
 * Imported by BulkImportDialog — no server round-trip required.
 */

export interface ParsedMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ParsedConversation {
  title: string;
  messages: ParsedMessage[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractText(val: unknown): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val)) {
    return val
      .map((p) =>
        typeof p === "string"
          ? p
          : (p as any)?.text ?? (p as any)?.content ?? (p as any)?.value ?? "",
      )
      .join("");
  }
  if (val && typeof val === "object") {
    const v = val as any;
    if (Array.isArray(v.parts)) return v.parts.map(extractText).join("");
    return v.text ?? v.value ?? v.content ?? "";
  }
  return String(val ?? "");
}

function toRole(r: unknown): "user" | "assistant" | null {
  if (typeof r !== "string") return null;
  const s = r.toLowerCase().trim();
  if (s === "user" || s === "human") return "user";
  if (s === "assistant" || s === "grok" || s === "ai" || s === "bot" || s === "system")
    return "assistant";
  return null;
}

// ── Conversation parser ───────────────────────────────────────────────────────

function parseConversation(obj: unknown): ParsedConversation | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  // Locate the message list under several common key names
  let raws: unknown[] = [];
  if (Array.isArray(o.messages)) raws = o.messages;
  else if (Array.isArray(o.turns)) raws = o.turns;
  else if (Array.isArray(o.conversation)) raws = o.conversation;
  else if (Array.isArray(o.history)) raws = o.history;
  else if (o.mapping && typeof o.mapping === "object")
    raws = Object.values(o.mapping as Record<string, unknown>);

  const messages: ParsedMessage[] = [];

  for (const m of raws) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, unknown>;

    // Some formats nest the actual message one level deeper
    const inner =
      msg.message && typeof msg.message === "object"
        ? (msg.message as Record<string, unknown>)
        : msg;

    // role — try every field name different exporters use
    let roleRaw: unknown =
      inner.role ?? inner.author ?? inner.sender ?? msg.sender ?? msg.role ?? msg.author;
    if (roleRaw && typeof roleRaw === "object" && (roleRaw as any).role)
      roleRaw = (roleRaw as any).role;

    const role = toRole(roleRaw);
    if (!role) continue;

    // content — try every field name different exporters use
    // Note: msg.message may be the plain-string content (Grok backend format)
    let content = "";
    if (inner.content && typeof inner.content === "object") {
      const c = inner.content as any;
      content = Array.isArray(c.parts) ? c.parts.map(extractText).join("") : extractText(c);
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
    (typeof o.title === "string" && o.title) ||
    (typeof o.name === "string" && o.name) ||
    (typeof o.subject === "string" && o.subject) ||
    (typeof (o as any).conversationTitle === "string" && (o as any).conversationTitle) ||
    messages.find((m) => m.role === "user")?.content.slice(0, 80) ||
    "Imported conversation";
  const title = titleRaw;

  return {
    title: title.slice(0, 255) || "Imported conversation",
    messages,
  };
}

// ── File parser ───────────────────────────────────────────────────────────────

/**
 * Parse a single JSON file's text content into zero or more conversations.
 * Handles:
 *   - Array of conversation objects
 *   - Single conversation object
 *   - Container object with a known array key (conversations, chats, data, …)
 *   - Raw message array (single conversation)
 */
export function parseFileJson(text: string): ParsedConversation[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }

  if (Array.isArray(json)) {
    const first = json[0] as any;
    // Array of conversation objects
    if (
      first &&
      (Array.isArray(first?.messages) ||
        Array.isArray(first?.turns) ||
        Array.isArray(first?.conversation) ||
        first?.mapping)
    ) {
      return json.flatMap((item) => {
        const c = parseConversation(item);
        return c ? [c] : [];
      });
    }
    // Raw message array → single conversation
    if (first?.role || first?.author) {
      const c = parseConversation({ messages: json });
      return c ? [c] : [];
    }
    return [];
  }

  // Single conversation object
  const single = parseConversation(json);
  if (single) return [single];

  // Container with a known array key
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const key of [
      "conversations",
      "chats",
      "data",
      "history",
      "items",
      "results",
      "threads",
    ]) {
      if (Array.isArray(o[key])) {
        const results = (o[key] as unknown[]).flatMap((item) => {
          const c = parseConversation(item);
          return c ? [c] : [];
        });
        if (results.length > 0) return results;
      }
    }
  }

  return [];
}
