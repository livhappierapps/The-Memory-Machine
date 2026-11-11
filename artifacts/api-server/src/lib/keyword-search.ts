// Keyword search over message *content* (not just thread titles).
//
// Messages may be legacy plaintext (searched in SQL with ILIKE) or encrypted
// with enc:v1: (cannot be searched in SQL — decrypted and scanned in-process,
// bounded by `scanLimit`). Always scoped to one user and to threads that are
// not soft-deleted.

import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { decryptField } from "./field-crypto";
import { logger } from "./logger";

export interface KeywordSearchOptions {
  userId: string;
  query: string;
  role?: "all" | "user" | "assistant";
  /** Thread created_at lower/upper bounds (inclusive). */
  from?: Date;
  to?: Date;
  /** Max threads returned. */
  limit?: number;
  /** Max encrypted messages decrypted per search (newest first). */
  scanLimit?: number;
}

export interface KeywordHit {
  threadId: number;
  /** Distinct query terms matched anywhere in the thread (title or messages). */
  termsMatched: number;
  /** Matching message count. */
  messageHits: number;
  titleHit: boolean;
  /** Plaintext excerpt around the first match in a message (if any). */
  snippet?: { role: string; text: string };
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "it", "i", "me", "my", "about", "what", "that", "this"]);

/** Split a free-text query into search terms (quoted phrases kept together). */
export function extractTerms(query: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const t = (m[1] ?? m[2] ?? "").trim().toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!t) continue;
    if (!m[1] && (t.length < 2 || STOP.has(t))) continue;
    if (!terms.includes(t)) terms.push(t);
  }
  // Fall back to the raw query if every word was a stop-word.
  if (terms.length === 0 && query.trim()) terms.push(query.trim().toLowerCase());
  return terms.slice(0, 8);
}

/** Escape LIKE wildcards so user input is matched literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Excerpt of `text` around the first occurrence of any term. */
export function excerpt(text: string, terms: string[], width = 240): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0 || text.length <= width) return text.length > width ? text.slice(0, width) + "…" : text;
  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(text.length, start + width);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

function matchedTerms(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  return terms.filter((t) => lower.includes(t));
}

export async function keywordSearchThreads(opts: KeywordSearchOptions): Promise<KeywordHit[]> {
  const { userId, role = "all", from, to } = opts;
  const limit = opts.limit ?? 10;
  const scanLimit = opts.scanLimit ?? 5_000;
  const terms = extractTerms(opts.query);
  if (terms.length === 0) return [];

  const patterns = terms.map((t) => `%${escapeLike(t)}%`);
  const anyPattern = (col: SQL) =>
    sql.join(patterns.map((p) => sql`${col} ILIKE ${p} ESCAPE '\\'`), sql` OR `);
  const roleSql = role === "all" ? sql`AND m.role IN ('user','assistant')` : sql`AND m.role = ${role}`;
  const fromSql = from ? sql`AND t.created_at >= ${from}` : sql``;
  const toSql = to ? sql`AND t.created_at <= ${to}` : sql``;

  const hits = new Map<number, { terms: Set<string>; messageHits: number; titleHit: boolean; snippet?: { role: string; text: string } }>();
  const hit = (threadId: number) => {
    let h = hits.get(threadId);
    if (!h) { h = { terms: new Set(), messageHits: 0, titleHit: false }; hits.set(threadId, h); }
    return h;
  };

  // 1. Titles.
  const titles = await db.execute<{ id: number; title: string }>(sql`
    SELECT t.id, t.title FROM threads t
    WHERE t.user_id = ${userId} AND t.deleted_at IS NULL ${fromSql} ${toSql}
      AND (${anyPattern(sql`t.title`)})
    LIMIT 200
  `);
  for (const r of titles.rows) {
    const h = hit(Number(r.id));
    h.titleHit = true;
    for (const t of matchedTerms(r.title, terms)) h.terms.add(t);
  }

  // 2. Plaintext message content (SQL ILIKE).
  const plain = await db.execute<{ thread_id: number; role: string; content: string }>(sql`
    SELECT m.thread_id, m.role, m.content
    FROM messages m JOIN threads t ON t.id = m.thread_id
    WHERE t.user_id = ${userId} AND t.deleted_at IS NULL ${roleSql} ${fromSql} ${toSql}
      AND m.content NOT LIKE 'enc:v1:%'
      AND (${anyPattern(sql`m.content`)})
    ORDER BY m.created_at DESC
    LIMIT 1000
  `);
  for (const r of plain.rows) {
    const h = hit(Number(r.thread_id));
    const mt = matchedTerms(r.content, terms);
    for (const t of mt) h.terms.add(t);
    h.messageHits++;
    if (!h.snippet && mt.length) h.snippet = { role: r.role, text: excerpt(r.content, terms) };
  }

  // 3. Encrypted message content: decrypt-and-scan (bounded, newest first).
  const enc = await db.execute<{ thread_id: number; role: string; content: string }>(sql`
    SELECT m.thread_id, m.role, m.content
    FROM messages m JOIN threads t ON t.id = m.thread_id
    WHERE t.user_id = ${userId} AND t.deleted_at IS NULL ${roleSql} ${fromSql} ${toSql}
      AND m.content LIKE 'enc:v1:%'
    ORDER BY m.created_at DESC
    LIMIT ${scanLimit}
  `);
  let undecryptable = 0;
  for (const r of enc.rows) {
    let text: string;
    try {
      text = decryptField(userId, r.content);
    } catch {
      undecryptable++;
      continue;
    }
    const mt = matchedTerms(text, terms);
    if (mt.length === 0) continue;
    const h = hit(Number(r.thread_id));
    for (const t of mt) h.terms.add(t);
    h.messageHits++;
    if (!h.snippet) h.snippet = { role: r.role, text: excerpt(text, terms) };
  }
  if (undecryptable) logger.warn({ undecryptable }, "keywordSearchThreads: skipped undecryptable messages");

  return [...hits.entries()]
    .map(([threadId, h]) => ({
      threadId,
      termsMatched: h.terms.size,
      messageHits: h.messageHits,
      titleHit: h.titleHit,
      snippet: h.snippet,
    }))
    .sort(
      (a, b) =>
        b.termsMatched - a.termsMatched ||
        Number(b.titleHit) - Number(a.titleHit) ||
        b.messageHits - a.messageHits,
    )
    .slice(0, limit);
}
