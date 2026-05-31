---
name: cost-optimization
description: AI API cost hacks, model tiering strategies, caching, batching, token reduction, free tiers, and how to build expensive AI features cheaply.
---

# AI API Cost Optimization — Master Reference

## The Cost Reality

### Typical AI App Cost Structure
Without optimization, a busy AI chat app can cost $0.01-$0.10 per conversation turn. At scale:
- 1,000 users × 20 turns/day × $0.05 = $1,000/day = $365,000/year

With the strategies below, cut that by 60-90%.

### xAI / Grok Pricing (mid-2025, approximate)
Check `x.ai/api` for current rates — prices drop frequently.
- Grok-3: ~$3-5 / million input tokens, ~$15 / million output tokens  
- Grok-3-mini: ~$0.30 / million input tokens, ~$0.50 / million output tokens
- text-embedding-3-small: ~$0.02 / million tokens

**10x cost savings just by using grok-3-mini for appropriate tasks.**

### OpenAI Pricing (for comparison/fallback)
- GPT-4o: ~$2.50 / million input, ~$10 / million output
- GPT-4o-mini: ~$0.15 / million input, ~$0.60 / million output
- text-embedding-3-small: ~$0.02 / million tokens

### Anthropic Pricing (for comparison/fallback)
- Claude Sonnet 3.5: ~$3 / million input, ~$15 / million output
- Claude Haiku: ~$0.25 / million input, ~$1.25 / million output

## Strategy 1: Model Tiering

Never use a premium model when a cheaper one works.

```
Task                    → Model
─────────────────────────────────────────────
User-facing chat        → grok-3 (quality matters)
Background summarization → grok-3-mini (10x cheaper)
Classification/routing  → grok-3-mini (simple task)
Embedding generation    → text-embedding-3-small (cheapest)
Title generation        → grok-3-mini (no quality difference)
OTP/security analysis   → rule-based code (free)
Data validation         → Zod schemas (free)
```

### Implementing the Tiering Decision
```typescript
function selectModel(task: "chat" | "summarize" | "classify" | "embed"): string {
  switch (task) {
    case "chat": return "grok-3";
    case "summarize": return "grok-3-mini";
    case "classify": return "grok-3-mini";
    case "embed": return "text-embedding-3-small";
  }
}
```

## Strategy 2: Aggressive Summarization

### The Math
- 100-message thread: ~80,000 tokens to send to model each turn
- After summarization: ~3,000 tokens (system summary) + last 20 messages (~16,000 tokens)
- Savings: ~76% per request after thread matures

### Trigger Point
Summarize when thread exceeds N messages. Store as `isSummary=true, role="system"`.
Use grok-3-mini for the summarization call — it's fine for this task.

```typescript
const SUMMARIZE_THRESHOLD = 20; // messages
// Run async, never block the user's response
if (messageCount > SUMMARIZE_THRESHOLD && messageCount % 10 === 0) {
  setImmediate(() => summarizeThread(threadId, userId));
}
```

## Strategy 3: Context Window Budgeting

Don't just grab the last N messages. Budget intelligently:

```typescript
const TOTAL_BUDGET = 400_000; // chars (~100k tokens) — leaves room for response
const PER_MEMORY_BUDGET = 4_000; // chars per memory source
const RECENT_MESSAGE_BUDGET = 50_000; // chars for recent history

// Priority order:
// 1. System prompt (fixed, always)
// 2. Pinned memory sources (user-specified important context)
// 3. Semantic memory (most relevant to current query)
// 4. Recent messages (most recent first until budget exhausted)
```

Trimming from the front of a long conversation is naive. Trim from the least-relevant part: old messages in unrelated threads, verbose passages in retrieved memory.

## Strategy 4: Semantic Cache (Advanced)

Cache responses for semantically similar questions. Users often ask similar things.

```typescript
// Before calling the model:
const queryEmbedding = await embed(userMessage);
const cached = await db.execute(sql`
  SELECT response, 1 - (query_embedding <=> ${queryEmbedding}::vector) as sim
  FROM response_cache
  WHERE user_id = ${userId} AND sim > 0.97
  ORDER BY sim DESC LIMIT 1
`);
if (cached.rows[0]) return cached.rows[0].response;
// else: call model, store result in cache
```

Practical threshold: 0.97 cosine similarity is essentially the same question. Below 0.95, too risky.

Use for: FAQ-type queries, repeated requests about the same topic, template-driven content.

Don't use for: highly personalized responses, anything requiring current context.

## Strategy 5: Streaming = Perceived Performance, Not Cost

Streaming costs the SAME as non-streaming (same tokens generated). But it:
- Makes users feel the app is faster (first token latency)
- Reduces abandonment (users wait longer for visible progress)
- Allows early termination if user navigates away (saves tokens)

**Always stream user-facing responses.** Only skip streaming for background tasks.

## Strategy 6: Token Counting Before Sending

Count tokens BEFORE the API call. Abort or trim if over budget.

```typescript
// Rough estimate: 4 chars ≈ 1 token
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Before API call:
const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
if (totalTokens > 90_000) {
  messages = trimMessages(messages, 90_000);
}
```

Use `tiktoken` (OpenAI's tokenizer) for exact counts. Rough estimates are fine for budget decisions.

## Strategy 7: Batch Embeddings

Never embed one message at a time in a loop. The xAI/OpenAI embedding API accepts arrays:

```typescript
const texts = messages.map(m => m.content.slice(0, 8000));
const response = await client.embeddings.create({
  model: "text-embedding-3-small",
  input: texts, // array of up to 2048 inputs
});
const embeddings = response.data.map(d => d.embedding);
```

One API call for N embeddings vs N API calls. Saves latency AND reduces per-call overhead.

## Strategy 8: Embedding Only What Matters

Not every message needs to be embedded:
- Skip `system` messages (they're instructions, not memories)
- Skip very short messages (< 20 chars) — not enough signal for meaningful similarity
- Skip messages you've already embedded (check before insert)
- Skip `isSummary=true` messages (derived from messages you already embedded)

```typescript
const shouldEmbed = (msg: Message) =>
  ["user", "assistant"].includes(msg.role) &&
  msg.content.length >= 20 &&
  !msg.isSummary &&
  !msg.embeddingId; // already done
```

## Strategy 9: Free Tier Stacking

### APIs with Free/Generous Tiers
- **xAI/Grok**: $25 free credit on signup; check current promotions at x.ai/api
- **Anthropic**: $5 free credit on signup
- **OpenAI**: API access is paid, but generous limits at low cost
- **Cohere**: Free tier for embeddings (10k/month) — good for dev
- **Voyage AI**: Better embedding quality than OpenAI, free tier available
- **Upstash**: Free Redis for rate limiting + caching (no local Redis needed)
- **Neon**: Free PostgreSQL + pgvector (this is what Replit uses for DATABASE_URL)
- **Resend**: 3,000 emails/month free (for OTP/notifications)
- **Clerk**: Free tier up to 10k MAU

### For Development/Testing
During dev, set hard limits to avoid accidental cost overruns:
```typescript
if (process.env.NODE_ENV === "development") {
  MAX_TOKENS_PER_REQUEST = 2000;
  MAX_REQUESTS_PER_USER_PER_HOUR = 10;
}
```

## Strategy 10: Response Caching by Type

| Response Type | Cache? | TTL |
|---|---|---|
| Thread list | Yes | 30 seconds |
| Message history | Yes | 5 seconds |
| AI streaming response | No | Never |
| Memory preview | Yes | 2 minutes |
| Stats/counts | Yes | 1 minute |
| Settings | Yes | 5 minutes |
| Embeddings | Yes | Permanent |

Use `Cache-Control` headers for client-side caching; use in-memory or Redis for server-side.

## Strategy 11: Provider Routing by Cost

Route tasks to the cheapest provider that meets quality bar:

```typescript
async function routeCompletion(task: Task): Promise<CompletionResult> {
  // For simple tasks, use cheapest model
  if (task.complexity === "simple") {
    return await callGrokMini(task);
  }
  // For complex, use best model but with strict token limit
  return await callGrok3(task, { maxTokens: 1000 });
}
```

## Strategy 12: Avoid Unnecessary Re-Computation

In our codebase:
- **Embeddings are stored**: Don't re-embed a message that already has an embedding
- **Summaries are stored**: Don't re-summarize threads that already have `isSummary` messages
- **Profile settings are cached**: Don't re-query settings on every message in a thread
- **Thread context is assembled once**: Assemble the full context, then stream — don't re-fetch during streaming

## Monitoring Cost in Production

### What to Track
```typescript
// Log token usage on every API call
logger.info({
  userId,
  provider: "xai",
  model,
  inputTokens: usage.prompt_tokens,
  outputTokens: usage.completion_tokens,
  estimatedCostUSD: (usage.prompt_tokens * 0.000003 + usage.completion_tokens * 0.000015),
}, "AI API call");
```

### Alerts to Set
- Per-user daily spend > $0.50 → warn
- Per-user daily spend > $2 → block and notify
- Global daily spend > $50 → alert on-call
- Embedding queue depth > 100 → warn (backlog forming)

## The Free AI API Landscape (2025)

### Truly Free Options
- **Ollama** (local models): Run Llama 3, Mistral, Phi-3 locally. Free but requires hardware. Good for dev.
- **Groq** (not Grok): Hardware inference provider, very cheap rates, generous free tier, llama/mistral models
- **Together AI**: Generous free tier for open-source models
- **Replicate**: Pay-per-use, very cheap for small models

### When to Use Open Source Models
- Privacy-sensitive apps (data never leaves your server)
- Very high volume (cost scales linearly with open-source)
- Fine-tuning needs (can fine-tune open models, not proprietary ones)
- Offline capability requirement

### The Cost Ceiling
The best optimization is building apps that users love enough to pay for. B2C AI apps with subscription models ($10-30/month) can afford $2-5/month in AI costs per user while remaining profitable. Focus engineering on engagement and value delivery, not infinite cost optimization.
