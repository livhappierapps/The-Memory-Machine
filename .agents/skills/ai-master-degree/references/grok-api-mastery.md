---
name: grok-api-mastery
description: Deep operational knowledge of xAI Grok API — models, endpoints, tricks, limitations, and advanced patterns discovered in production.
---

# Grok / xAI API Mastery

## Models (as of mid-2025)

| Model | Best For | Notes |
|---|---|---|
| `grok-3` | Primary chat, complex reasoning | Best quality, higher cost |
| `grok-3-mini` | Summarization, classification, bulk tasks | 10-20x cheaper, fast |
| `grok-3-turbo` | Balanced speed/quality | Mid-tier pricing |
| `grok-2-vision` | Image + text understanding | Multimodal input |
| `text-embedding-3-small` | Semantic embeddings | Dim: 1536, good for pgvector |

**Model selection strategy**: Use `grok-3` for the user-facing turn. Use `grok-3-mini` for background tasks (summarization, classification, re-ranking). Never use the full model for a task the mini can handle.

## Endpoints

```
Base URL: https://api.x.ai/v1
Chat:       POST /chat/completions       (OpenAI-compatible)
Embeddings: POST /embeddings             (OpenAI-compatible)
```

Because xAI uses the OpenAI-compatible format, any OpenAI SDK works as a drop-in with `baseURL: "https://api.x.ai/v1"`.

```typescript
import OpenAI from "openai";
const xai = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1" });
```

## SSE Streaming — Raw Implementation

The OpenAI SDK handles streaming automatically, but knowing the raw format unlocks custom parsing:

```
data: {"id":"...","choices":[{"delta":{"content":"token"}}]}
data: [DONE]
```

Parse `data: ` prefix, JSON-parse the payload, extract `choices[0].delta.content`. Stop on `[DONE]`. This is what `streamGrokCompletion()` in `lib/grok.ts` does. Useful when the SDK adds unwanted overhead.

## Context Window

- Grok-3: ~131k token context window (≈524k chars)
- Grok-3-mini: ~131k token context window
- Practical limit: stay under 100k tokens to avoid performance degradation at edges
- **In this codebase**: GLOBAL_CHAR_BUDGET = 400,000 chars ≈ 100k tokens (safe zone)

## Tricks & Workarounds

### 1. Personality Injection via System Prompt
Grok has a default persona. Override it completely with a strong opening system message:
```
You are [Name]. [Core traits]. [Communication style]. [Specific knowledge/context].
Never break character. Never acknowledge you are an AI unless directly asked.
```
The more specific and vivid the persona, the more consistent the output.

### 2. Multi-Turn Role Alternation Enforcement
Grok (like most models) expects `user → assistant → user → assistant...`. If you send two consecutive user messages, behavior degrades. Always normalize message arrays before sending — coalesce consecutive same-role messages or insert a brief assistant bridge.

### 3. Recursive Context Compression
When threads grow long, don't truncate from the beginning (loses early context). Instead:
1. Summarize the oldest N messages into a `system` message: "Earlier in this conversation: ..."
2. Keep the most recent M messages verbatim
3. Always preserve the very first user message (establishes intent)

### 4. Embedding Input Cap
xAI's embedding API has an input limit. Safe practice: slice to 8,000 chars before sending:
```typescript
const safeText = text.slice(0, 8_000);
```
For longer content, chunk into overlapping segments and average the embeddings.

### 5. Batch Embedding Queue
Don't hit the embeddings endpoint synchronously per-message. Queue inserts, process with `MAX_CONCURRENCY = 4` workers, retry on 429s with exponential backoff. In `lib/embeddings.ts` this pattern is already implemented.

### 6. Model Tiering for Cost Control
```
User message received → grok-3 (full response)
Thread hits 20 msgs  → grok-3-mini (summarize → system message)
Background embedding  → text-embedding-3-small
Classification task   → grok-3-mini
```
This pattern cuts costs by 60-80% vs using grok-3 for everything.

### 7. System Prompt as Memory Anchor
Instead of sending hundreds of past messages, distill them into a structured system prompt:
```
[MEMORY SUMMARY]
- User prefers concise answers
- Working on: React app with dark theme
- Mentioned they have a dog named "Max"
- Last session: debugging authentication flow
[END MEMORY]
```
This is more token-efficient than raw history and more reliable for personality continuity.

### 8. Provider Shifting
Build a unified `streamCompletion(provider, model, messages, key)` function. When xAI is down or rate-limited, transparently shift to Anthropic or OpenAI with the same interface. Users experience continuity; backend adapts.

### 9. MCP as Grok Extension
The Model Context Protocol allows Grok (the app) to call your custom tools. Build an MCP server at `/api/mcp` with Bearer token auth. Tools you can expose: search memories, get conversation, get summaries, set reminders, query your DB. Grok's "Connector" feature in the app is how users link to your MCP endpoint.

### 10. Grok's xAI vs Grok App
- **Grok API** (`api.x.ai`): What you call programmatically. No NSFW filter by default on the API — content policy is your responsibility.
- **Grok app** (`grok.com`, X app): Has more filters. Has "Unfiltered Grok" mode for X Premium+ users (this is the *app*, not the *API*).
- When using the *API*, you control the system prompt entirely. Grok will follow reasonable persona/tone instructions without pushback.

## Limitations to Know

| Limitation | Workaround |
|---|---|
| No persistent memory natively | Build your own (pgvector + retrieval) |
| No native function calling UI | Use MCP or parse structured JSON from responses |
| Rate limits (depends on tier) | Queue + exponential backoff + multi-key rotation |
| Context forgets everything above window | Summarize + distill + pin key facts |
| Embeddings input cap | Chunk and slice at 8k chars |
| No native voice input/output | Pipe through Whisper (input) + TTS provider (output) |
| No native vision on all models | Use `grok-2-vision` endpoint specifically |

## Rate Limit Handling

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err.status === 429) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}
```

## xAI API Key Security

- Store encrypted: `encryptField(userId, apiKey)` → `enc:v1:<base64>`
- Never log API keys, even truncated
- Store hash alongside for quick existence checks
- Rotate on any suspicion of exposure
- Per-user keys > shared keys (isolates blast radius)

## What Grok Does Exceptionally Well

- Long context coherence (better than GPT-4 at keeping long stories straight)
- Technical explanation with personality (doesn't sound robotic)
- Following complex persona instructions
- Open-ended creative tasks
- Real-time web knowledge (when DeepSearch enabled)
- Reasoning through ambiguous problems when prompted to "think step by step"

## Grok's Known Weaknesses (as of mid-2025)

- Occasionally verbose when brevity is requested — combat with explicit "Be concise" in system
- Can be sycophantic — counter with "Disagree with me when I'm wrong"
- Mathematical reasoning slightly behind o3/Claude 3.5 for very hard problems
- No native code execution (use tool calls or separate sandbox)
- Image generation not in API (only Grok app)
