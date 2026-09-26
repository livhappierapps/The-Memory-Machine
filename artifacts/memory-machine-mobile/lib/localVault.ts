/**
 * On-device vault: parse Grok / ChatGPT / generic JSON exports and persist
 * threads locally so Memory Machine works while Replit is dark.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LegacyFileSystem from "expo-file-system/legacy";
import JSZip from "jszip";

const STORAGE_KEY = "mm.localVault.v1";

export type LocalRole = "user" | "assistant";

export interface LocalMessage {
  role: LocalRole;
  content: string;
}

export interface LocalThread {
  id: string;
  title: string;
  createdAt: string;
  sourceFile?: string;
  messages: LocalMessage[];
}

export interface LocalImportResult {
  imported: number;
  skipped: number;
  errors: number;
  threads: LocalThread[];
}

function toRole(r: unknown): LocalRole | null {
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
  ) {
    return "assistant";
  }
  return null;
}

function extractText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return (v as unknown[]).map(extractText).join(" ").trim();
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of [
      "text",
      "value",
      "content",
      "body",
      "response",
      "transcription",
      "caption",
      "description",
    ]) {
      if (typeof o[k] === "string" && (o[k] as string).trim()) return o[k] as string;
    }
    if (Array.isArray(o.parts)) return (o.parts as unknown[]).map(extractText).join("").trim();
    if (Array.isArray(o.children)) return (o.children as unknown[]).map(extractText).join("").trim();
  }
  return "";
}

function attachmentLabel(attachments: unknown): string {
  if (!Array.isArray(attachments) || attachments.length === 0) return "";
  return (attachments as unknown[])
    .map((a) => {
      if (!a || typeof a !== "object") return "[Attachment]";
      const at = a as Record<string, unknown>;
      const type = String(at.type ?? at.mimeType ?? at.mediaType ?? "attachment").toLowerCase();
      if (type.includes("image") || type.includes("photo")) return "[Image]";
      if (type.includes("video")) return "[Video]";
      if (type.includes("audio") || type.includes("voice")) return "[Audio]";
      if (type.includes("pdf") || type.includes("doc") || type.includes("file")) {
        return `[File: ${String(at.name ?? at.fileName ?? at.filename ?? "File")}]`;
      }
      return "[Attachment]";
    })
    .join(" ");
}

function tryExtractMessages(raws: unknown[]): LocalMessage[] {
  const messages: LocalMessage[] = [];
  for (const m of raws) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, unknown>;
    const inner =
      msg.message && typeof msg.message === "object"
        ? (msg.message as Record<string, unknown>)
        : msg.response && typeof msg.response === "object"
          ? (msg.response as Record<string, unknown>)
          : msg;

    let roleRaw: unknown =
      inner.role ?? inner.author ?? inner.sender ?? msg.sender ?? msg.role ?? msg.author;
    if (roleRaw && typeof roleRaw === "object" && (roleRaw as Record<string, unknown>).role) {
      roleRaw = (roleRaw as Record<string, unknown>).role;
    }
    const role = toRole(roleRaw);
    if (!role) continue;

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
        inner.transcription;
      content = extractText(rawContent);
    }

    if (!content.trim()) {
      content = attachmentLabel(msg.attachments ?? inner.attachments ?? msg.files ?? inner.files);
    }
    if (!content.trim()) {
      const hasAudio =
        msg.audio != null ||
        inner.audio != null ||
        msg.isAudio === true ||
        String(msg.type ?? inner.type ?? "").toLowerCase().includes("audio") ||
        String(msg.type ?? inner.type ?? "").toLowerCase().includes("voice");
      if (hasAudio) content = "[Voice message]";
    }
    if (content.trim()) messages.push({ role, content: content.trim() });
  }
  return messages;
}

function parseConversationItem(o: unknown): { title: string; messages: LocalMessage[] } | null {
  if (!o || typeof o !== "object") return null;
  const c = o as Record<string, unknown>;
  let raws: unknown[] = [];
  const knownKeys = [
    "messages",
    "turns",
    "conversation",
    "history",
    "responses",
    "exchanges",
    "items",
    "entries",
    "chat",
    "dialogue",
    "thread",
  ];
  for (const key of knownKeys) {
    if (Array.isArray(c[key]) && (c[key] as unknown[]).length > 0) {
      raws = c[key] as unknown[];
      break;
    }
  }
  if (raws.length === 0 && c.mapping && typeof c.mapping === "object") {
    raws = Object.values(c.mapping as Record<string, unknown>);
  }
  if (raws.length === 0) {
    for (const val of Object.values(c)) {
      if (Array.isArray(val) && val.length > 0) {
        const candidate = tryExtractMessages(val as unknown[]);
        if (candidate.length > 0) {
          raws = val as unknown[];
          break;
        }
      }
    }
  }
  const messages = tryExtractMessages(raws);
  if (messages.length === 0) return null;
  const titleRaw =
    (typeof c.title === "string" && c.title) ||
    (typeof c.name === "string" && c.name) ||
    (typeof c.subject === "string" && c.subject) ||
    (typeof c.conversationTitle === "string" && c.conversationTitle) ||
    messages.find((m) => m.role === "user")?.content.slice(0, 80) ||
    "Imported conversation";
  return { title: String(titleRaw).slice(0, 255) || "Imported conversation", messages };
}

function extractConversations(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  for (const key of ["conversations", "chats", "messages", "data", "history", "items"]) {
    if (Array.isArray(o[key]) && (o[key] as unknown[]).length > 0) return o[key] as unknown[];
  }
  const asOne = parseConversationItem(o);
  if (asOne) return [o];
  for (const val of Object.values(o)) {
    if (Array.isArray(val) && (val as unknown[]).length > 0) return val as unknown[];
  }
  return [];
}

export async function loadLocalThreads(): Promise<LocalThread[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LocalThread[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveLocalThreads(threads: LocalThread[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}

export async function deleteLocalThread(id: string): Promise<LocalThread[]> {
  const next = (await loadLocalThreads()).filter((t) => t.id !== id);
  await saveLocalThreads(next);
  return next;
}

export function searchLocalThreads(threads: LocalThread[], query: string): LocalThread[] {
  const q = query.trim().toLowerCase();
  if (!q) return threads;
  return threads.filter((t) => {
    if (t.title.toLowerCase().includes(q)) return true;
    return t.messages.some((m) => m.content.toLowerCase().includes(q));
  });
}

async function readJsonPayloads(fileUri: string, fileName: string): Promise<string[]> {
  const lower = fileName.toLowerCase();
  const isZip = lower.endsWith(".zip");
  if (!isZip) {
    return [await LegacyFileSystem.readAsStringAsync(fileUri, { encoding: "utf8" })];
  }
  const b64 = await LegacyFileSystem.readAsStringAsync(fileUri, { encoding: "base64" });
  const zip = await JSZip.loadAsync(b64, { base64: true });
  const jsonEntries = Object.entries(zip.files).filter(
    ([name, f]) => !f.dir && name.toLowerCase().endsWith(".json"),
  );
  if (jsonEntries.length === 0) {
    throw new Error("No JSON files found inside the ZIP archive.");
  }
  const texts: string[] = [];
  for (const [, entry] of jsonEntries) {
    texts.push(await entry.async("string"));
  }
  return texts;
}

export async function importLocalFile(
  fileUri: string,
  fileName: string,
): Promise<LocalImportResult> {
  const payloads = await readJsonPayloads(fileUri, fileName);
  const rawConversations: unknown[] = [];
  let parseErrors = 0;

  for (const jsonText of payloads) {
    try {
      const json = JSON.parse(jsonText) as unknown;
      const extracted = extractConversations(json);
      if (extracted.length === 0) parseErrors += 1;
      else rawConversations.push(...extracted);
    } catch {
      parseErrors += 1;
    }
  }

  if (rawConversations.length === 0) {
    throw new Error(
      "No conversations found. Use a Grok export ZIP or a conversations JSON file.",
    );
  }

  const existing = await loadLocalThreads();
  const seen = new Set(existing.map((t) => `${t.title}::${t.messages.length}`));
  const added: LocalThread[] = [];
  let skipped = 0;
  let errors = parseErrors;

  for (const raw of rawConversations) {
    try {
      const conv = parseConversationItem(raw);
      if (!conv) {
        skipped += 1;
        continue;
      }
      const dedupe = `${conv.title}::${conv.messages.length}`;
      if (seen.has(dedupe)) {
        skipped += 1;
        continue;
      }
      seen.add(dedupe);
      added.push({
        id: `local-${Date.now()}-${added.length}-${Math.random().toString(36).slice(2, 8)}`,
        title: conv.title,
        createdAt: new Date().toISOString(),
        sourceFile: fileName,
        messages: conv.messages,
      });
    } catch {
      errors += 1;
    }
  }

  const next = [...added, ...existing];
  await saveLocalThreads(next);
  return { imported: added.length, skipped, errors, threads: next };
}
