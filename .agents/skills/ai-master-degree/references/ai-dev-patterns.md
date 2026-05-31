---
name: ai-dev-patterns
description: Advanced AI development patterns — SSE streaming, memory architecture, embeddings, MCP, context budgeting, field encryption, summarization, multi-provider abstraction. Specific to this codebase's production implementation.
---

# Advanced AI Development Patterns

## SSE Streaming Architecture

### The Pattern
```
Client → POST /api/threads/:id/stream
Server → Content-Type: text/event-stream
Server → data: {"type":"user_message","message":{...}}\n\n
Server → data: {"type":"memory_sources","sources":[...]}\n\n
Server → data: {"type":"token","content":"Hello"}\n\n  (many times)
Server → data: {"type":"done","message":{...}}\n\n
Client → Render each token as it arrives
```

### Why This Matters
- Users perceive first-token latency, not total latency
- Show the user's message immediately (don't wait for AI response)
- Show memory sources as soon as retrieved (before tokens arrive)
- Heartbeat pings every 15s prevent proxy timeouts on long responses
- On error: emit `{"type":"error","message":"..."}` so UI can recover gracefully

### Express SSE Setup
```typescript
res.setHeader("Content-Type", "text/event-stream");
res.setHeader("Cache-Control", "no-cache");
res.setHeader("Connection", "keep-alive");
res.setHeader("X-Accel-Buffering", "no"); // critical for nginx/reverse proxies

const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
```

### Client-Side Hook Pattern (React)
```typescript
const eventSource = new EventSource(`/api/threads/${id}/stream`, { withCredentials: true });
eventSource.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "token") appendToken(msg.content);
  if (msg.type === "done") finalize(msg.message);
  if (msg.type === "error") showError(msg.message);
};
// Always clean up
return () => eventSource.close();
```

## Memory Architecture (Hybrid Retrieval)

### The Three-Layer Stack
```
Layer 1: PINNED — Always inject. User-curated "always remember" threads.
Layer 2: SEMANTIC — pgvector cosine similarity search against current query.
Layer 3: RECENT — Fill budget with newest threads not already included.
```

### Why Three Layers?
- **Pinned**: Explicit user control. "Remember my name is Alex, I'm a developer."
- **Semantic**: Surfaces relevant past context the user didn't think to pin.
- **Recent**: Ensures continuity — recent events are almost always relevant.

### Context Budgeting Algorithm
```typescript
const SOFT_PER_SOURCE_BUDGET = 4_000; // chars per memory source
const MAX_TOTAL_CONTEXT_CHARS = 40_000; // total memory budget
const GLOBAL_CHAR_BUDGET = 400_000; // full context window budget

// Build context: newest messages first, reverse-walk until budget exhausted
// This preserves recency while making budget decisions deterministically
```

### pgvector Setup
```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE embeddings ADD COLUMN embedding vector(1536);
CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

Cosine similarity query:
```typescript
const results = await db.execute(sql`
  SELECT message_id, 1 - (embedding <=> ${queryEmbedding}::vector) as similarity
  FROM embeddings
  WHERE thread_id IN (${userThreadIds})
  ORDER BY similarity DESC
  LIMIT ${topN}
`);
```

### Embedding Strategy
- Embed `user` + `assistant` messages only (not `system`)
- Chunk long messages at 8k chars before embedding
- Store embedding alongside the message record for fast retrieval
- Queue embeddings asynchronously (don't block the chat response)
- Use `MAX_CONCURRENCY = 4` workers to avoid rate limits

## Field Encryption (AES-256-GCM + HKDF)

### Why Per-User Keys Matter
A single global encryption key means one breach → all data exposed. Per-user HKDF derivation means breaching user A's key doesn't affect user B.

```typescript
// Derive per-user key from root secret
import { createHmac, hkdfSync, randomBytes, createCipheriv, createDecipheriv } from "crypto";

function deriveKey(userId: string): Buffer {
  return hkdfSync("sha256", ROOT_SECRET, userId, "field-encryption-v1", 32);
}

function encryptField(userId: string, plaintext: string): string {
  const key = deriveKey(userId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "enc:v1:" + Buffer.concat([iv, tag, ct]).toString("base64");
}

function decryptField(userId: string, value: string): string {
  if (!value.startsWith("enc:v1:")) return value; // migration-safe passthrough
  const buf = Buffer.from(value.slice(7), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const key = deriveKey(userId);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
```

### Migration-Safe Pattern
The `enc:v1:` prefix check in `decryptField` means old plaintext rows are returned as-is. Run a migration script to backfill — rows progressively encrypt as they're updated.

### What to Encrypt
- Message content (conversations are intimate data)
- API keys (per-provider keys in profiles)
- MCP tokens (sensitive auth tokens)
- Any PII that lives in the DB

### What NOT to Encrypt
- Thread titles (need to search them)
- Timestamps, IDs, foreign keys
- Non-sensitive metadata (model name, message role)
- Anything you need to query against in SQL

## Thread Summarization (Background "Memory Machine")

### Trigger
When a thread exceeds N messages (e.g., 20), kick off an async summarizer:
```typescript
setImmediate(() => maybeSummarizeThread(threadId, userId));
```
Never block the streaming response for this.

### Summarizer Pattern
```typescript
const summary = await model.chat([
  { role: "system", content: "Summarize this conversation in 3-5 bullet points. Focus on facts, decisions, and key topics." },
  ...recentMessages
]);
// Store as isSummary=true system message
await db.insert(messagesTable).values({ threadId, role: "system", content: summary, isSummary: true });
```

### Using Summaries in Context
When assembling context, prefer the `isSummary` message over full message history for older threads. This reduces token usage from O(n) to O(1) per summarized thread.

## MCP (Model Context Protocol) Integration

### What MCP Is
MCP is a standard that lets LLMs call external tools. Grok's app has a "Connectors" UI that points to your MCP endpoint. You expose tools; Grok decides when to call them.

### Your MCP Endpoint Shape
```typescript
POST /api/mcp  — handles all MCP protocol messages
GET  /api/mcp  — returns server capabilities
Auth: Bearer <mcpToken>  — NOT Clerk; MCP has its own token
```

### Designing Good MCP Tools
- Each tool should do ONE thing clearly
- Tool descriptions are read by the LLM — write them like documentation
- Return structured JSON, not narrative text
- Include count/total fields so the LLM can decide to paginate
- Keep response payloads small — the LLM is paying tokens to read them

### Token Storage Security
Store MCP tokens as SHA-256 hashes only. On verify:
```typescript
const hash = createHash("sha256").update(rawToken).digest("hex");
const settings = await db.select().from(settingsTable).where(eq(settingsTable.mcpTokenHash, hash));
```
Never store the raw token. If the hash DB is breached, tokens are still safe.

## Multi-Provider AI Abstraction

### The Interface
```typescript
interface StreamResult {
  stream: AsyncIterable<string>; // token deltas
  usage?: { promptTokens: number; completionTokens: number };
}

async function streamCompletion(
  provider: "xai" | "openai" | "anthropic" | "google",
  model: string,
  messages: ChatMessage[],
  apiKey: string,
  systemPrompt?: string,
): Promise<StreamResult>
```

### Provider Quirks to Handle
| Provider | Quirk |
|---|---|
| Anthropic | Requires alternating `user`/`assistant` roles — coalesce same-role messages |
| Anthropic | System prompt is a separate `system` parameter, not a message |
| Google Gemini | System prompt is `systemInstruction`, not in `contents` |
| xAI | OpenAI-compatible — simplest to integrate |
| OpenAI | Function calling format differs from Anthropic's tool_use |

### Normalizing Messages for Anthropic
```typescript
function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const msg of messages) {
    const last = result[result.length - 1];
    if (last && last.role === msg.role) {
      last.content += "\n\n" + msg.content;
    } else {
      result.push({ ...msg });
    }
  }
  return result;
}
```

## Device Trust Architecture

### Flow
```
User attempts destructive action
  → requireTrustedDevice middleware
    → if req.deviceTrusted: proceed
    → else: return 403 { error: "device_challenge_required" }

User triggers challenge:
  POST /api/security/devices/challenge
    → generate UUID device token
    → generate 6-digit OTP
    → email OTP via Resend (or return inline in dev mode)

User verifies:
  POST /api/security/devices/verify  { token, otp }
    → verify OTP, store SHA-256(token) in trusted_devices
    → set httpOnly cookie "mm_device" = token (90-day expiry)
    → mobile: return token for X-Device-Token header storage
```

### Why SHA-256 the Device Token?
Same reason as MCP tokens — if the trusted_devices table is breached, raw tokens aren't exposed. The hash lookup is constant-time against the DB.

## Data Snapshot Architecture

### Snapshot Flow
```
createSnapshot(userId, label)
  → query all threads + messages for user
  → serialize to JSON
  → gzip compress
  → store in snapshots table with metadata
  → return snapshot record

restoreSnapshot(userId, snapshotId, res)
  → SSE stream progress to client
  → for each thread in snapshot:
      → create thread with "(Restored)" prefix
      → batch-insert messages
      → emit progress event
  → emit done event
```

### When to Auto-Snapshot
- Before any `execute-final` deletion
- Weekly cron (catches all users)
- On user request (manual backup)
- Purge snapshots older than 30 days

## Rate Limiting Strategy

### In-Memory Rate Limiter (No Redis Required)
```typescript
const store = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = store.get(key) ?? { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  store.set(key, entry);
  return entry.count <= limit;
}
// Cleanup: setInterval(() => store.forEach((v,k) => Date.now() > v.resetAt && store.delete(k)), 10_min)
```

### Rate Limit Tiers
| Endpoint Category | Limit | Window |
|---|---|---|
| Auth endpoints | 5 req | 15 min |
| AI streaming | 20 req | 1 min |
| Import/export | 3 req | 5 min |
| General API | 200 req | 15 min |

## Prompt Engineering Principles

### The Anatomy of a Great System Prompt
```
1. ROLE — Who is the AI? Vivid, specific identity.
2. CONTEXT — What does it know? What's the situation?
3. MEMORY — What past facts are relevant? (injected dynamically)
4. BEHAVIOR — How does it communicate? Tone, style, length.
5. CONSTRAINTS — What won't it do? What must it always do?
6. TASK — What is it trying to accomplish right now?
```

### Chain-of-Thought for Complex Tasks
Add to system prompt: "Before answering, think through the problem step by step inside <thinking> tags. Then give your final answer."
This dramatically improves reasoning quality. Strip the `<thinking>` section from the streamed output if you don't want users to see it.

### Structured Output Extraction
Ask for JSON in the system prompt + use response parsing:
```typescript
const content = "Give your response as JSON: { answer: string, confidence: number, sources: string[] }";
const raw = await model.complete(content);
const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
```
More reliable than asking Grok to use function calling for simple structured extraction.
