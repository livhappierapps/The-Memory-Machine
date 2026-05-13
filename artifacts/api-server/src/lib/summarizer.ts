/**
 * summarizer.ts — Background thread summarization pipeline.
 *
 * When a thread grows beyond SUMMARIZE_THRESHOLD messages and has no existing
 * summary, this module calls Grok to produce a concise summary and stores it
 * as a message with isSummary=true. The summary is then preferentially used
 * by the memory retrieval engine instead of loading the raw messages.
 *
 * Called fire-and-forget after each streaming completion.
 */

import { db } from "@workspace/db";
import { threadsTable, messagesTable } from "@workspace/db";
import { eq, and, desc, asc } from "drizzle-orm";
import { logger } from "./logger";

/** Minimum number of messages in a thread before we attempt summarization. */
const SUMMARIZE_THRESHOLD = 20;

/** Maximum character length of source content sent to the summarizer. */
const MAX_SOURCE_CHARS = 30_000;

const SYSTEM_PROMPT = `You are a concise memory summarizer. 
Summarize the following conversation into 3-5 bullet points that capture the most important facts, decisions, preferences, and context. 
Be specific and factual. Avoid filler. Output ONLY the bullet points, no preamble.`;

async function callGrokForSummary(apiKey: string, content: string, model = "grok-3-mini"): Promise<string | null> {
  try {
    const resp = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
        stream: false,
        max_tokens: 600,
        temperature: 0.3,
      }),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Grok summarizer request failed");
      return null;
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    logger.warn({ err }, "callGrokForSummary fetch failed");
    return null;
  }
}

/**
 * Checks whether a thread needs summarization; if so, generates a summary
 * and stores it. Safe to call multiple times — idempotent via the isSummary check.
 */
export async function maybeSummarizeThread(
  threadId: number,
  apiKey: string,
  model?: string,
): Promise<void> {
  try {
    // Already have a summary? Skip.
    const [existing] = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(eq(messagesTable.threadId, threadId), eq(messagesTable.isSummary, true)))
      .limit(1);

    if (existing) return;

    // Not enough messages yet? Skip.
    const [thread] = await db
      .select({ messageCount: threadsTable.messageCount })
      .from(threadsTable)
      .where(eq(threadsTable.id, threadId));

    if (!thread || thread.messageCount < SUMMARIZE_THRESHOLD) return;

    // Load the full conversation (non-summary messages only)
    const messages = await db
      .select({ role: messagesTable.role, content: messagesTable.content })
      .from(messagesTable)
      .where(and(eq(messagesTable.threadId, threadId), eq(messagesTable.isSummary, false)))
      .orderBy(asc(messagesTable.createdAt));

    // Build compact text representation, capped at MAX_SOURCE_CHARS
    let source = "";
    for (const m of messages) {
      const line = `${m.role === "user" ? "User" : "Assistant"}: ${m.content}\n\n`;
      if (source.length + line.length > MAX_SOURCE_CHARS) break;
      source += line;
    }

    if (!source.trim()) return;

    const summary = await callGrokForSummary(apiKey, source, model);
    if (!summary) return;

    await db.insert(messagesTable).values({
      threadId,
      role: "assistant",
      content: summary,
      isSummary: true,
    });

    logger.info({ threadId }, "Thread summary generated and stored");
  } catch (err) {
    logger.warn({ err, threadId }, "maybeSummarizeThread failed");
  }
}

/**
 * Fire-and-forget wrapper — call this after streaming completes.
 */
export function maybeSummarizeAsync(threadId: number, apiKey: string, model?: string): void {
  maybeSummarizeThread(threadId, apiKey, model).catch((err) =>
    logger.warn({ err, threadId }, "maybeSummarizeAsync unhandled error"),
  );
}
