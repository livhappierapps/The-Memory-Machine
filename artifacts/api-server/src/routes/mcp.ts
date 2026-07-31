/**
 * mcp.ts — Model Context Protocol server for Memory Machine.
 *
 * Exposes memory tools that the real Grok app can call via a custom connector.
 * Auth: Authorization: Bearer <mcpToken> header — never put the token in the URL.
 *
 * Grok connector URL: POST https://<domain>/api/mcp
 * Custom header:      Authorization: Bearer <token>
 *
 * Tools:
 *   save_memory              — write a new note/memory that Leo wants to remember
 *   search_memories          — semantic + keyword search across all conversations
 *   search_by_date           — find conversations within a date range
 *   list_recent_conversations — most recently active threads
 *   get_conversation         — full message history of a specific thread
 *   get_pinned_memories      — threads the user has pinned
 *   get_memory_summary       — head / middle / tail snapshot of a conversation arc
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  settingsTable,
  threadsTable,
  messagesTable,
  profilesTable,
} from "@workspace/db";
import {
  eq,
  and,
  desc,
  or,
  gte,
  lte,
  isNull,
  inArray,
  ilike,
  asc,
  sql,
} from "drizzle-orm";
import { logger } from "../lib/logger";
import { sha256Hex, encryptField, decryptField } from "../lib/field-crypto";
import { generateEmbedding, storeEmbedding } from "../lib/embeddings";

const router: IRouter = Router();

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getUserIdByToken(token: string): Promise<string | null> {
  const tokenHash = sha256Hex(token);

  // Primary: hash-based lookup (post-migration and all new tokens)
  const [byHash] = await db
    .select({ userId: settingsTable.userId })
    .from(settingsTable)
    .where(eq(settingsTable.mcpTokenHash, tokenHash))
    .limit(1);
  if (byHash) return byHash.userId;

  // Fallback: plaintext lookup for pre-migration rows not yet visited by getOrCreateSettings
  const [byPlain] = await db
    .select({ userId: settingsTable.userId })
    .from(settingsTable)
    .where(eq(settingsTable.mcpToken, token))
    .limit(1);
  return byPlain?.userId ?? null;
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// ── Profile helpers ───────────────────────────────────────────────────────────

interface ProfileInfo {
  id: number;
  apiKey: string | null;
  embeddingProvider: string;
}

/**
 * Load the user's first profile (lowest id = default created on sign-up).
 * Used to obtain the API key for embedding generation in MCP tools.
 */
async function getDefaultProfile(userId: string): Promise<ProfileInfo | null> {
  const [profile] = await db
    .select({
      id: profilesTable.id,
      apiKey: profilesTable.apiKey,
      embeddingProvider: profilesTable.embeddingProvider,
    })
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId))
    .orderBy(asc(profilesTable.id))
    .limit(1);
  return profile ?? null;
}

// ── Tool helpers ──────────────────────────────────────────────────────────────

function fmtMsg(m: { role: string; content: string }, maxLen = 300) {
  const snip = m.content.length > maxLen ? m.content.slice(0, maxLen) + "…" : m.content;
  return `[${m.role.toUpperCase()}]: ${snip}`;
}

function fmtThread(t: {
  id: number;
  title: string;
  messageCount: number;
  pinned: boolean;
  lastMessageAt: Date | null;
  createdAt: Date;
}) {
  const date = (t.lastMessageAt ?? t.createdAt).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
  const pin = t.pinned ? " 📌" : "";
  return `- #${t.id}${pin} "${t.title}" — ${t.messageCount} messages, last active ${date}`;
}

// ── MCP server factory ────────────────────────────────────────────────────────

function buildMcpServer(userId: string): McpServer {
  const server = new McpServer({ name: "Memory Machine", version: "1.1.0" });

  // ── save_memory ───────────────────────────────────────────────────────────
  server.tool(
    "save_memory",
    [
      "Save a new memory, note, or piece of information to the Memory Machine vault.",
      "Use this when you want to remember something for the future — a decision made, a project detail,",
      "a personal note, something the user told you, or any information worth keeping.",
      "The memory is stored as a pinned conversation and is immediately searchable.",
      "Returns the ID of the saved memory so you can retrieve it later with get_conversation.",
    ].join(" "),
    {
      title: z
        .string()
        .min(1)
        .max(200)
        .describe(
          "A short, descriptive title for this memory (e.g. 'Middlemain project — authentication decisions', 'User prefers dark themes'). This becomes the conversation title visible in the app.",
        ),
      content: z
        .string()
        .min(1)
        .max(50_000)
        .describe(
          "The full text of the memory. Can be plain prose, a list, structured notes — whatever captures what you want to remember.",
        ),
      pin: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to pin this memory so it always surfaces in context (default true — pin it)."),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of short tags or categories (e.g. ['project', 'middlemain', 'architecture']). Prepended to the content to improve searchability.",
        ),
    },
    async ({ title, content, pin, tags }) => {
      try {
        // Prepend tags to content so they improve keyword + semantic search
        const tagLine = tags && tags.length > 0
          ? `[Tags: ${tags.join(", ")}]\n\n`
          : "";
        const fullContent = `${tagLine}${content}`;

        // Look up the default profile so we can generate an embedding
        const profile = await getDefaultProfile(userId);

        // Create the thread
        const [thread] = await db
          .insert(threadsTable)
          .values({
            userId,
            profileId: profile?.id ?? null,
            title,
            pinned: pin ?? true,
            archived: false,
            model: "grok-3",
            messageCount: 0,
          })
          .returning({ id: threadsTable.id });

        if (!thread) {
          return {
            content: [{ type: "text", text: "Failed to create memory thread." }],
            isError: true,
          };
        }

        const threadId = thread.id;

        // Insert the content as an encrypted message
        const encryptedContent = encryptField(userId, fullContent);
        const [message] = await db
          .insert(messagesTable)
          .values({
            threadId,
            role: "user",
            content: encryptedContent,
            isSummary: false,
          })
          .returning({ id: messagesTable.id });

        // Update message count and last_message_at on the thread
        await db.execute(sql`
          UPDATE threads
          SET message_count = 1,
              last_message_at = now()
          WHERE id = ${threadId}
        `);

        // Generate and store an embedding in the background (needs API key)
        if (message && profile?.apiKey) {
          generateEmbedding(fullContent, profile.apiKey, profile.embeddingProvider)
            .then((vec) => vec ? storeEmbedding(message.id, threadId, profile.id, vec) : undefined)
            .catch((err) => logger.warn({ err }, "MCP save_memory: embedding failed"));
        }

        const pinNote = (pin ?? true) ? " (pinned)" : "";
        return {
          content: [
            {
              type: "text",
              text: [
                `✅ Memory saved${pinNote}: "${title}" (ID: #${threadId})`,
                "",
                "You can retrieve it later with: get_conversation(thread_id: " + threadId + ")",
                "Or search for it with: search_memories(query: \"" + title.slice(0, 50) + "\")",
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, "MCP save_memory error");
        return { content: [{ type: "text", text: "Error saving memory." }], isError: true };
      }
    },
  );

  // ── search_memories ──────────────────────────────────────────────────────
  server.tool(
    "search_memories",
    [
      "Search through all stored conversation memories.",
      "Uses semantic (vector) search when possible for meaning-aware results,",
      "falling back to keyword search on conversation titles.",
      "Supports keywords, phrases, names, emotions, topics — anything.",
      "Returns matching excerpts grouped by conversation.",
      "Use this when you want to recall something specific from the past.",
    ].join(" "),
    {
      query: z.string().describe(
        "What to search for. Can be a keyword, a name, a feeling, a topic, a phrase — e.g. 'beach trip', 'feeling lonely', 'the thing about butterflies'",
      ),
      limit: z.number().int().min(1).max(20).optional().default(5)
        .describe("Max conversations to return (default 5)"),
      role: z.enum(["all", "user", "assistant"]).optional().default("all")
        .describe("Whose messages to search — 'user' for what was said to the AI, 'assistant' for AI replies, 'all' for both"),
    },
    async ({ query, limit, role }) => {
      try {
        const maxResults = limit ?? 5;
        const resultThreadIds = new Set<number>();
        const threadScores = new Map<number, number>(); // threadId → best similarity score

        // ── Path 1: semantic search via pgvector ─────────────────────────────
        const profile = await getDefaultProfile(userId);
        if (profile?.apiKey) {
          const queryVec = await generateEmbedding(query, profile.apiKey, profile.embeddingProvider);
          if (queryVec) {
            const vecLiteral = `[${queryVec.join(",")}]`;

            type SemRow = { thread_id: number; score: number };
            const semRows = await db.execute<SemRow>(sql`
              SELECT thread_id, score
              FROM (
                SELECT DISTINCT ON (e.thread_id)
                  e.thread_id,
                  1 - (e.embedding <=> ${vecLiteral}::vector) AS score
                FROM embeddings e
                JOIN threads t ON t.id = e.thread_id
                WHERE t.user_id = ${userId}
                  AND t.deleted_at IS NULL
                ORDER BY e.thread_id, e.embedding <=> ${vecLiteral}::vector
              ) best_per_thread
              WHERE score > 0.3
              ORDER BY score DESC
              LIMIT ${maxResults * 2}
            `);

            for (const row of semRows.rows) {
              resultThreadIds.add(row.thread_id);
              threadScores.set(row.thread_id, row.score);
            }
          }
        }

        // ── Path 2: keyword search on thread titles (always runs as fallback/supplement) ──
        const terms = query.trim().split(/\s+/).filter(Boolean);
        if (terms.length > 0) {
          const titleThreads = await db
            .select({ id: threadsTable.id })
            .from(threadsTable)
            .where(
              and(
                eq(threadsTable.userId, userId),
                isNull(threadsTable.deletedAt),
                or(
                  ...terms.map((t) => ilike(threadsTable.title, `%${t}%`)),
                ),
              ),
            )
            .limit(maxResults);

          for (const t of titleThreads) {
            if (!resultThreadIds.has(t.id)) {
              resultThreadIds.add(t.id);
              threadScores.set(t.id, 0); // keyword match, no vector score
            }
          }
        }

        if (resultThreadIds.size === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No memories found matching "${query}". The vault may not contain conversations about this topic yet.`,
              },
            ],
          };
        }

        // ── Load thread metadata and a message snippet for each result ───────
        const ids = [...resultThreadIds].slice(0, maxResults);
        const threads = await db
          .select({
            id: threadsTable.id,
            title: threadsTable.title,
            pinned: threadsTable.pinned,
            lastMessageAt: threadsTable.lastMessageAt,
            createdAt: threadsTable.createdAt,
          })
          .from(threadsTable)
          .where(inArray(threadsTable.id, ids));

        const threadMap = new Map(threads.map((t) => [t.id, t]));

        // Sort: vector score DESC (title-only keyword matches go at the end)
        const sortedIds = ids.sort(
          (a, b) => (threadScores.get(b) ?? 0) - (threadScores.get(a) ?? 0),
        );

        // Fetch one representative message per thread (first matching role)
        const roleCondition =
          role === "user"
            ? eq(messagesTable.role, "user")
            : role === "assistant"
              ? eq(messagesTable.role, "assistant")
              : undefined;

        const output: string[] = [];
        for (const threadId of sortedIds) {
          const t = threadMap.get(threadId);
          if (!t) continue;

          const msgs = await db
            .select({ role: messagesTable.role, content: messagesTable.content })
            .from(messagesTable)
            .where(and(eq(messagesTable.threadId, threadId), roleCondition))
            .orderBy(desc(messagesTable.createdAt))
            .limit(3);

          const excerpts = msgs.map((m) =>
            fmtMsg({ role: m.role, content: decryptField(userId, m.content) }),
          );

          const score = threadScores.get(threadId);
          const scoreNote =
            score && score > 0
              ? ` (similarity: ${Math.round(score * 100)}%)`
              : "";
          const pin = t.pinned ? " 📌" : "";
          const date = (t.lastMessageAt ?? t.createdAt).toLocaleDateString("en-US", {
            year: "numeric", month: "short", day: "numeric",
          });

          output.push(
            [
              `## Conversation #${threadId}${pin}: "${t.title}"${scoreNote} — ${date}`,
              ...excerpts,
            ].join("\n"),
          );
        }

        return {
          content: [
            {
              type: "text",
              text: [
                `Found memories matching "${query}" in ${output.length} conversation(s):`,
                "",
                output.join("\n\n---\n\n"),
                "",
                "Use get_conversation with a conversation ID to read the full text.",
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, "MCP search_memories error");
        return { content: [{ type: "text", text: "Error searching memories." }], isError: true };
      }
    },
  );

  // ── search_by_date ───────────────────────────────────────────────────────
  server.tool(
    "search_by_date",
    [
      "Find conversations that took place within a specific date range.",
      "Use when you want to remember what was discussed on a certain day, month, or period.",
      "Dates should be in YYYY-MM-DD format.",
    ].join(" "),
    {
      from: z.string().optional().describe(
        "Start date in YYYY-MM-DD format (e.g. '2024-01-15'). Omit to search from the very beginning.",
      ),
      to: z.string().optional().describe(
        "End date in YYYY-MM-DD format (e.g. '2024-12-31'). Omit to search up to today.",
      ),
      keyword: z.string().optional().describe(
        "Optional keyword to further filter within the date range",
      ),
      limit: z.number().int().min(1).max(50).optional().default(10)
        .describe("Max conversations to return (default 10)"),
    },
    async ({ from, to, keyword, limit }) => {
      try {
        const fromDate = from ? new Date(from) : undefined;
        const toDate = to ? new Date(to + "T23:59:59Z") : undefined;

        if (fromDate && isNaN(fromDate.getTime())) {
          return { content: [{ type: "text", text: `Invalid 'from' date: "${from}". Use YYYY-MM-DD format.` }], isError: true };
        }
        if (toDate && isNaN(toDate.getTime())) {
          return { content: [{ type: "text", text: `Invalid 'to' date: "${to}". Use YYYY-MM-DD format.` }], isError: true };
        }

        const conditions: ReturnType<typeof eq>[] = [
          eq(threadsTable.userId, userId),
          isNull(threadsTable.deletedAt),
        ];
        if (fromDate) conditions.push(gte(threadsTable.createdAt, fromDate));
        if (toDate) conditions.push(lte(threadsTable.createdAt, toDate));
        if (keyword) conditions.push(ilike(threadsTable.title, `%${keyword}%`));

        const threads = await db
          .select({
            id: threadsTable.id,
            title: threadsTable.title,
            messageCount: threadsTable.messageCount,
            pinned: threadsTable.pinned,
            lastMessageAt: threadsTable.lastMessageAt,
            createdAt: threadsTable.createdAt,
          })
          .from(threadsTable)
          .where(and(...conditions))
          .orderBy(desc(threadsTable.createdAt))
          .limit(limit ?? 10);

        if (threads.length === 0) {
          const dateRange = from || to
            ? ` between ${from ?? "the beginning"} and ${to ?? "today"}`
            : "";
          return {
            content: [
              {
                type: "text",
                text: `No conversations found${dateRange}${keyword ? ` containing "${keyword}"` : ""}.`,
              },
            ],
          };
        }

        const header = (() => {
          if (from && to) return `Conversations between ${from} and ${to}`;
          if (from) return `Conversations since ${from}`;
          if (to) return `Conversations up to ${to}`;
          return "All conversations";
        })();

        const lines = threads.map(fmtThread);
        return {
          content: [
            {
              type: "text",
              text: `${header} (${threads.length} found):\n\n${lines.join("\n")}\n\nUse get_conversation with a conversation ID to read the full text.`,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, "MCP search_by_date error");
        return { content: [{ type: "text", text: "Error searching by date." }], isError: true };
      }
    },
  );

  // ── list_recent_conversations ────────────────────────────────────────────
  server.tool(
    "list_recent_conversations",
    "List the most recently active conversations in the memory vault. Use to orient yourself — to see what has been talked about recently.",
    {
      limit: z.number().int().min(1).max(50).optional().default(10)
        .describe("Number of conversations to list (default 10)"),
      include_archived: z.boolean().optional().default(false)
        .describe("Whether to include archived conversations (default false)"),
    },
    async ({ limit, include_archived }) => {
      try {
        const conditions = [eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt)];
        if (!include_archived) conditions.push(eq(threadsTable.archived, false));

        const threads = await db
          .select({
            id: threadsTable.id,
            title: threadsTable.title,
            messageCount: threadsTable.messageCount,
            pinned: threadsTable.pinned,
            lastMessageAt: threadsTable.lastMessageAt,
            createdAt: threadsTable.createdAt,
          })
          .from(threadsTable)
          .where(and(...conditions))
          .orderBy(desc(threadsTable.updatedAt))
          .limit(limit ?? 10);

        if (threads.length === 0) {
          return { content: [{ type: "text", text: "No conversations found in the memory vault." }] };
        }

        const lines = threads.map(fmtThread);
        return {
          content: [
            {
              type: "text",
              text: `Recent conversations (${threads.length} shown):\n\n${lines.join("\n")}\n\nUse get_conversation with a conversation ID to read the full text, or search_memories to find something specific.`,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, "MCP list_recent_conversations error");
        return { content: [{ type: "text", text: "Error listing conversations." }], isError: true };
      }
    },
  );

  // ── get_conversation ─────────────────────────────────────────────────────
  server.tool(
    "get_conversation",
    "Retrieve the full message history of a specific conversation by its ID. Use when you want to read everything said in a particular conversation.",
    {
      thread_id: z.number().int()
        .describe("The conversation ID (from list_recent_conversations, search_memories, or search_by_date)"),
      max_messages: z.number().int().min(1).max(500).optional().default(100)
        .describe("Max messages to return from the end of the conversation (default 100)"),
    },
    async ({ thread_id, max_messages }) => {
      try {
        const [thread] = await db
          .select()
          .from(threadsTable)
          .where(and(eq(threadsTable.id, thread_id), eq(threadsTable.userId, userId)))
          .limit(1);

        if (!thread) {
          return { content: [{ type: "text", text: `Conversation #${thread_id} not found.` }], isError: true };
        }

        const messages = await db
          .select({ role: messagesTable.role, content: messagesTable.content, createdAt: messagesTable.createdAt })
          .from(messagesTable)
          .where(eq(messagesTable.threadId, thread_id))
          .orderBy(messagesTable.createdAt);

        const slice = messages.slice(-(max_messages ?? 100));
        const transcript = slice
          .map((m) => fmtMsg({ ...m, content: decryptField(userId, m.content) }, 1000))
          .join("\n\n");

        const date = (thread.lastMessageAt ?? thread.createdAt).toLocaleDateString("en-US", {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
        });
        const truncNote =
          messages.length > slice.length
            ? `\n_(Showing last ${slice.length} of ${messages.length} messages)_\n`
            : "";

        return {
          content: [
            {
              type: "text",
              text: `# Conversation #${thread.id}: "${thread.title}"\n${thread.messageCount} messages · ${date}${truncNote}\n\n${transcript}`,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, "MCP get_conversation error");
        return { content: [{ type: "text", text: "Error retrieving conversation." }], isError: true };
      }
    },
  );

  // ── get_pinned_memories ──────────────────────────────────────────────────
  server.tool(
    "get_pinned_memories",
    "Retrieve all conversations that have been pinned as important memories — the ones marked as most meaningful.",
    {},
    async () => {
      try {
        const threads = await db
          .select({
            id: threadsTable.id,
            title: threadsTable.title,
            messageCount: threadsTable.messageCount,
            pinned: threadsTable.pinned,
            lastMessageAt: threadsTable.lastMessageAt,
            createdAt: threadsTable.createdAt,
          })
          .from(threadsTable)
          .where(
            and(
              eq(threadsTable.userId, userId),
              eq(threadsTable.pinned, true),
              isNull(threadsTable.deletedAt),
            ),
          )
          .orderBy(desc(threadsTable.updatedAt));

        if (threads.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No pinned memories yet. Use save_memory to create a pinned note, or pin conversations from the Memory Machine app.",
              },
            ],
          };
        }

        const lines = threads.map(fmtThread);
        return {
          content: [
            {
              type: "text",
              text: `Pinned memories (${threads.length}):\n\n${lines.join("\n")}\n\nUse get_conversation with an ID to read the full content.`,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, "MCP get_pinned_memories error");
        return { content: [{ type: "text", text: "Error retrieving pinned memories." }], isError: true };
      }
    },
  );

  // ── get_memory_summary ───────────────────────────────────────────────────
  server.tool(
    "get_memory_summary",
    "Get a condensed snapshot of a conversation — the opening exchanges, a note on length, and the closing exchanges. Gives the arc of a conversation without reading it all.",
    {
      thread_id: z.number().int().describe("The conversation ID to summarise"),
    },
    async ({ thread_id }) => {
      try {
        const [thread] = await db
          .select()
          .from(threadsTable)
          .where(and(eq(threadsTable.id, thread_id), eq(threadsTable.userId, userId)))
          .limit(1);

        if (!thread) {
          return { content: [{ type: "text", text: `Conversation #${thread_id} not found.` }], isError: true };
        }

        const messages = await db
          .select({ role: messagesTable.role, content: messagesTable.content })
          .from(messagesTable)
          .where(eq(messagesTable.threadId, thread_id))
          .orderBy(messagesTable.createdAt);

        const head = messages
          .slice(0, 3)
          .map((m) => fmtMsg({ ...m, content: decryptField(userId, m.content) }, 250));
        const mid =
          messages.length > 9
            ? [`\n… (${messages.length - 6} more messages in the middle) …\n`]
            : [];
        const tail =
          messages.length > 6
            ? messages
                .slice(-3)
                .map((m) => fmtMsg({ ...m, content: decryptField(userId, m.content) }, 250))
            : [];

        const date = (thread.lastMessageAt ?? thread.createdAt).toLocaleDateString("en-US", {
          year: "numeric", month: "long", day: "numeric",
        });

        return {
          content: [
            {
              type: "text",
              text: `# Snapshot: "${thread.title}" (#${thread.id})\n${thread.messageCount} messages · ${date}\n\n${[...head, ...mid, ...tail].join("\n\n")}`,
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, "MCP get_memory_summary error");
        return { content: [{ type: "text", text: "Error generating summary." }], isError: true };
      }
    },
  );

  return server;
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleMcpRequest(req: Request, res: Response) {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing Authorization: Bearer <token> header." });
    return;
  }

  const userId = await getUserIdByToken(token).catch(() => null);
  if (!userId) {
    res.status(401).json({ error: "Invalid or unknown Memory Machine token." });
    return;
  }

  const server = buildMcpServer(userId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    req.log.error({ err }, "MCP request handling error");
    if (!res.headersSent) res.status(500).json({ error: "MCP server error" });
  }
}

// MCP spec requires POST; GET and DELETE are also wired for probing clients
router.post("/mcp", handleMcpRequest);
router.get("/mcp", handleMcpRequest);
router.delete("/mcp", handleMcpRequest);

export default router;
