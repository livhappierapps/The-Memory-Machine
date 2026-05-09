# Happier AI Vault — Project Documentation

## Overview

A full-stack dark-mode web application for permanently storing and continuing Grok AI conversations. Users sign in, create conversation threads, chat with Grok (streamed in real-time), and have every message persisted to PostgreSQL forever. The app works as Grok's "memory keeper" — it sends the full conversation history back to Grok on every message so context is never lost across sessions.

## Architecture

pnpm monorepo with TypeScript across all packages.

```
artifacts/
  api-server/          — Express 5 backend (port 8080, path /api)
  happier-ai-vault/    — React + Vite frontend (port 5173, path /)
  mockup-sandbox/      — Component preview server (port 8081, path /__mockup)
lib/
  db/                  — Drizzle ORM schema + PostgreSQL client
  api-spec/            — OpenAPI spec + Orval codegen config
  api-zod/             — Generated Zod schemas (from OpenAPI)
  api-client-react/    — Generated TanStack Query hooks (from OpenAPI)
scripts/               — Workspace utility scripts
```

## Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces |
| Node.js | v24 |
| TypeScript | 5.9 |
| Frontend | React 19, Vite 7, Tailwind CSS v4, shadcn/ui |
| Routing | wouter |
| Server state | TanStack Query v5 |
| Backend | Express 5 |
| Database | PostgreSQL + Drizzle ORM |
| Auth | Clerk (`@clerk/react`, `@clerk/express`) |
| Validation | Zod v4, drizzle-zod |
| API contract | OpenAPI → Orval codegen |
| Build | esbuild (API server) |
| Logging | pino + pino-http |

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## File Structure (Key Files)

### Frontend (`artifacts/happier-ai-vault/src/`)

```
pages/
  home.tsx             — Landing page (hero, sign-in/up)
  vault.tsx            — Main app shell (sidebar + chat panel, mobile toggle)
  settings.tsx         — API key, model, context settings
  not-found.tsx        — 404

components/
  layout/
    app-layout.tsx     — Top nav with logo + Clerk user button
  vault/
    sidebar.tsx        — Thread list, New Vault button, ZIP import + stats triggers
    chat-area.tsx      — Message list, streaming indicator, input form
    stats-dialog.tsx   — Vault statistics modal (counts, active/archived)
    bulk-import-dialog.tsx — ZIP/JSON import dialog (chunked upload, reads SSE progress)
    import-dialog.tsx  — Single-thread paste/upload import
    export-dialog.tsx  — Single-thread JSON/markdown export
  ui/                  — shadcn/ui primitives

hooks/
  use-chat-stream.ts   — SSE streaming hook (connects to /api/threads/:id/stream)
  use-mobile.tsx       — Breakpoint detection
  use-toast.ts         — Toast notification hook

lib/
  queryClient.ts       — TanStack Query client config
  utils.ts             — Tailwind cn() helper
```

### Backend (`artifacts/api-server/src/`)

```
routes/
  index.ts             — Mounts all routers
  threads.ts           — CRUD for threads
  messages.ts          — Get/send/stream/import messages
  settings.ts          — User API key + model preferences
  stats.ts             — Aggregate counts (threads, messages)
  health.ts            — GET /api/healthz
  import.ts            — POST /api/import/chunk + POST /api/import/finalize (chunked upload + SSE)

lib/
  grok.ts              — streamGrokCompletion() — thin xAI API streaming wrapper
  logger.ts            — pino logger singleton
  import-stream.ts     — Server-side ZIP/JSON parser + batch DB insert + SSE progress

middlewares/
  auth.ts              — requireAuth middleware (Clerk userId extraction)
  clerkProxyMiddleware.ts — Clerk auth token extraction
```

## Database Schema (lib/db/src/schema/)

### threads
| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| userId | text | Clerk user ID |
| title | text | Thread display name |
| model | text | Grok model, default "grok-3" |
| archived | boolean | default false |
| pinned | boolean | default false |
| messageCount | integer | default 0 |
| lastMessageAt | timestamp | nullable |
| createdAt / updatedAt | timestamp | auto-managed |

### messages
| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| threadId | integer FK → threads | cascade delete |
| role | text | "user" \| "assistant" \| "system" |
| content | text | |
| isSummary | boolean | default false |
| createdAt | timestamp | |

### settings
| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| userId | text | unique, Clerk user ID |
| apiKey | text | nullable, xAI API key |
| defaultModel | text | default "grok-3" |
| maxContextMessages | integer | default 0 (0 = full history, 1–1000 = last N messages) |

## API Routes (all under /api, all require Clerk auth)

| Method | Path | Description |
|---|---|---|
| GET | /api/threads | List threads (query: search, archived) |
| POST | /api/threads | Create thread |
| GET | /api/threads/:id | Get single thread |
| PATCH | /api/threads/:id | Update thread (title, archived, pinned, model) |
| DELETE | /api/threads/:id | Delete thread + cascade messages |
| GET | /api/threads/:id/messages | Get all messages for a thread |
| POST | /api/threads/:id/messages | Save a user message (non-streaming) |
| POST | /api/threads/:id/stream | Stream Grok response via SSE |
| POST | /api/threads/:id/import | Import messages (JSON or plain text) |
| GET | /api/threads/:id/export | Export thread (json or markdown) |
| GET | /api/settings | Get user settings |
| PUT | /api/settings | Update user settings |
| GET | /api/stats | Get vault stats (thread/message counts) |
| POST | /api/import/chunk | Upload one 10 MB chunk (multipart) |
| POST | /api/import/finalize | Assemble chunks, parse, insert — streams SSE progress |

## Bulk Import (chunked upload + server-side streaming)

Triggered by the folder-archive icon in the sidebar. The file is split into 10 MB chunks in the browser; each chunk is uploaded independently before the server reassembles, parses, and inserts everything. This means no single HTTP request is large enough to be killed by a reverse proxy or mobile network timeout.

**Flow:**
1. User selects a `.zip` or `.json` file
2. `BulkImportDialog` splits the file into 10 MB slices
3. Each slice is POSTed to `POST /api/import/chunk` with `uploadId`, `chunkIndex`, `totalChunks`; a fresh Clerk auth token is fetched per chunk
4. Once all chunks are received, `POST /api/import/finalize` is called — server concatenates chunks, opens the ZIP with JSZip, finds the target JSON entry
5. `JSON.parse()` produces the full object; `extractConversations()` locates the conversation array
6. Conversations are parsed and batch-inserted to PostgreSQL in groups of 20
7. An SSE progress event is sent after every batch: `{ type: "progress", processed, imported, skipped }`
8. A final `{ type: "done", imported, skipped, errors }` event closes the stream
9. Temp files are deleted; the client refreshes the thread list

**`src/lib/import-stream.ts`** handles:
- ZIP archives and plain JSON files
- Top-level arrays and container objects (`conversations`, `chats`, `data`, `history`, `items`)
- Grok's `prod-grok-backend.json` format (`sender` / `message` fields)
- Various role names: `user`, `human`, `assistant`, `grok`, `ai`, `bot`
- Nested content: `.parts[]`, `.message.content`, author-as-object
- Aggressive fallback: scans ALL array-valued keys on conversation objects if known keys fail
- Batch DB inserts (20 threads + all their messages per query group)
- Postgres 65 535-parameter guard (chunked message inserts)
- Heartbeat comment frames every 8 s to keep the SSE connection alive through proxies
- 2 GB upload cap; iOS `application/octet-stream` MIME type detection for ZIPs

## Grok Streaming

`POST /api/threads/:id/stream` accepts `{ content: string }`, saves the user message, fetches the user's xAI API key from settings, loads thread history, and calls `streamGrokCompletion()` from `lib/grok.ts`.

`streamGrokCompletion(apiKey, model, messages, callbacks)` calls `https://api.x.ai/v1/chat/completions` with `stream: true` and fires `onToken(delta)` for each chunk and `onDone(fullContent)` / `onError(message)` at completion. Guards against a null `response.body` before reading.

Tokens are forwarded to the client via SSE (`data: { type: "token", content: "..." }`). On completion the assistant message is saved and `data: { type: "done", message: {...} }` is emitted.

The stream route respects `maxContextMessages` from the user's settings:
- `0` → send the **full conversation history** (no limit)
- `1–1000` → send only the last N messages (`history.slice(-N)`)

## Frontend Pages

- **/** — Landing page with hero circuit art, neon headline, Sign In / Sign Up
- **/vault** — Main app: sidebar (thread list + "New Vault" button) + chat area with real-time streaming
- **/settings** — Grok API key, default model, max context messages (0–1000)
- **/sign-in**, **/sign-up** — Clerk-managed auth pages

### Vault Mobile Layout

The vault uses a **full-screen panel toggle** pattern for mobile:
- **Mobile (< md breakpoint)**: sidebar and chat area each take 100% of the screen and are shown one at a time. Selecting a thread hides the sidebar and shows the chat full-screen. A `←` back button in the chat header returns to the thread list.
- **Desktop (≥ md)**: classic side-by-side layout — fixed `w-80` sidebar + `flex-1` chat area, unchanged.

## Design System

- **Theme**: Medium grey background (`hsl(240 8% 20%)`), white text, neon minty aqua (`hsl(174 85% 52%)`) accent — like the Statue of Liberty patina shifted cooler
- **Neon effects**: `neon-text`, `neon-text-pulse`, `neon-border`, `neon-box-pulse`, `neon-glow` CSS utility classes defined in `index.css`
- **Hero**: Circuit art PNG with transparent background and aqua drop-shadow at `public/hero-circuit.png`
- **Scrollbars**: Styled neon aqua
- **Clerk UI**: Themed to match (dark backgrounds, aqua primary, neon button glow)

## Environment Secrets

| Secret | Used by | Purpose |
|---|---|---|
| `SESSION_SECRET` | API server | Session signing |
| `CLERK_PUBLISHABLE_KEY` | API server + frontend (via vite define) | Clerk auth |
| `CLERK_SECRET_KEY` | API server | Clerk server-side verification |
| `DATABASE_URL` / `PG*` | lib/db | PostgreSQL connection |

**Note**: The frontend uses `CLERK_PUBLISHABLE_KEY` exposed via `vite.config.ts` `define` (as `VITE_CLERK_PUBLISHABLE_KEY`). Do NOT use `publishableKeyFromHost()` — it generates `clerk.localhost` URLs in the dev proxy context.

## Known Bugs Fixed

- **Thread list empty after navigation** — `zod.coerce.boolean()` coerces the string `"false"` to `true`, so `?archived=false` was querying for archived threads. Fixed by manually converting the string before Zod parsing in the threads route.
- **Thread list not refreshing after create** — HTTP 304 responses from server cache were hiding new threads. Fixed by adding `Cache-Control: no-store` middleware for all `/api` routes, and using `refetchType: "all"` in query invalidation.
- **Clerk JS failing to load** — `publishableKeyFromHost(hostname, key)` was generating `clerk.localhost` URLs via the dev proxy. Fixed by using the raw `CLERK_PUBLISHABLE_KEY` directly.
- **Vault layout overflowing on mobile** — sidebar was a fixed `w-80` (320px) with the chat area alongside it, causing overflow on phones (390px screen). Fixed with a full-screen panel toggle: sidebar and chat each take 100% width on mobile and alternate visibility based on state, with a back button in the chat header.
- **ZIP import crashing on mobile / "not fetching"** — Root cause: browser-side parsing of a 379 MB ZIP required loading the full archive + decompressed JSON into RAM, killing the tab on low-memory devices. Fixed by moving all parsing to the server with chunked upload: the browser sends 10 MB slices, the server reassembles, parses, and inserts, streaming SSE progress back. No browser memory limits; works on any device.
- **Import dialog closing immediately on Android** — Android fires `onOpenChange(false)` before the file picker `onChange` fires. Fixed with a 400 ms delayed check using a `phaseRef` — if the phase moved to "uploading" by then, the close event is swallowed.
- **Import showing "done, 0 saved"** — Parser format mismatch. Fixed by refactoring `import-stream.ts` into a `tryExtractMessages()` helper with an aggressive fallback that scans all array-valued keys on conversation objects when known field names (`messages`, `turns`, etc.) are absent.
- **SSE connection drop UX** — Long imports through a mobile network could silently stall. Fixed by reducing heartbeat interval to 8 s and adding an `interrupted` phase in the dialog with a "Check my conversations" button instead of a silent hang.
- **Duplicate messages on network retry** — `setQueryData` in `use-chat-stream.ts` could append the same message twice if an SSE event was replayed. Fixed by deduplicating on message ID before appending.

## Security Scan Results (last run: May 9 2026)

### Dependency Audit — 0 critical, 0 high, 0 moderate

All previously reported vulnerabilities have been fully remediated via `pnpm-workspace.yaml` overrides. The dependency scanner shows no remaining findings.

### SAST

- `[MEDIUM]` path traversal warnings in `import.ts` and `import-stream.ts` — false positives. The `uploadId` is UUID-regex validated before use; `filePath` is a server-generated temp path, not user-supplied. No actual traversal risk.
- `[MEDIUM]` unsafe dynamic module lookup in `artifacts/mockup-sandbox/src/App.tsx` — internal component preview sandboxing framework, not user-facing. Not a production risk.

### HoundDog — 0 findings

## Workflows

| Name | Command | Port |
|---|---|---|
| API Server | `pnpm --filter @workspace/api-server run dev` | 8080 |
| Happier AI Vault (web) | `pnpm --filter @workspace/happier-ai-vault run dev` | 5173 |
| Component Preview Server | `pnpm --filter @workspace/mockup-sandbox run dev` | 8081 |
