# Memory Engine Hardening — Planned Fixes

Branch: `fix/memory-engine-hardening` (from main @ da7ea10)

## Fixes to implement

### 1. Semantic search degradation warning
**File:** `artifacts/api-server/src/lib/memory.ts`

When `generateEmbedding()` returns null or the pgvector query throws, retrieval silently falls back to recency-only. The SSE `memory_sources` event still fires with only pinned/recent sources, so the UI shows nothing wrong.

**Fix:** Add a `degraded: boolean` field to `MemoryContext`. When the semantic path is skipped or fails, set it true and log at `warn` level with a structured reason. Emit it in the SSE event so the frontend can show a subtle "smart memory unavailable" indicator instead of silently degrading.

### 2. Summarizer refresh
**File:** `artifacts/api-server/src/lib/summarizer.ts`

`maybeSummarizeThread` is one-shot: once an `isSummary` row exists it returns immediately. Long-running threads accumulate stale summaries.

**Fix:** Track `summaryMessageCount` (or compare against `threads.messageCount`) and regenerate when the thread has grown by >= 20 messages since the last summary. Delete the old summary row (or overwrite it) before inserting the new one. Keep the idempotency guard for concurrent calls.

### 3. MCP multi-profile support
**File:** `artifacts/api-server/src/routes/mcp.ts`

`getDefaultProfile()` always returns the lowest-id profile. Users with multiple profiles (different API keys, embedding providers, memory date ranges) get the wrong context through the Memory Bridge.

**Fix:** Accept an optional `profile_id` (or `profile_name`) parameter on `search_memories`, `save_memory`, and `search_by_date`. Validate it belongs to `userId` before use. Fall back to default profile when omitted, with a note in the tool description telling the model it can pass a profile.

### 4. Re-embed on message edit (future)
If message editing is ever added, the old embedding for that `message_id` must be replaced — `storeEmbedding` already uses `ON CONFLICT (message_id) DO UPDATE`, so this is mostly a matter of calling `embedMessageAsync` from the edit route. Not blocking now.

## Verification

- `pnpm run typecheck` across all packages
- `pnpm --filter @workspace/api-server test` (30 existing tests + new ones for degraded flag and summarizer refresh)
- Manual: trigger a stream with a deliberately bad embedding key and confirm the SSE event carries `degraded: true`
