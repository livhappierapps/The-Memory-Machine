# Memory Machine — Project Documentation

## Overview

A full-stack dark-mode Grok AI conversation vault. Users sign in, create conversation threads, chat with Grok (streamed in real-time), and have every message persisted to PostgreSQL forever. The app works as Grok's "memory keeper" — it sends the full conversation history back to Grok on every message so context is never lost across sessions.

Available on **web** (React + Vite) and **mobile** (Expo React Native for iOS + Android), both sharing the same Express backend and PostgreSQL database.

## Architecture

pnpm monorepo with TypeScript across all packages.

```
artifacts/
  api-server/               — Express 5 backend (port 8080, path /api)
  happier-ai-vault/         — React + Vite web frontend (port 5173, path /)
  memory-machine-mobile/    — Expo React Native mobile app (iOS + Android)
  mockup-sandbox/           — Component preview server (port 8081, path /__mockup)
lib/
  db/                       — Drizzle ORM schema + PostgreSQL client
  api-spec/                 — OpenAPI spec + Orval codegen config
  api-zod/                  — Generated Zod schemas (from OpenAPI)
  api-client-react/         — Generated TanStack Query hooks (from OpenAPI)
scripts/                    — Workspace utility scripts
```

## Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces |
| Node.js | v24 |
| TypeScript | 5.9 |
| Web Frontend | React 19, Vite 7, Tailwind CSS v4, shadcn/ui |
| Mobile | Expo SDK 54, React Native 0.81, Expo Router v4 |
| Routing (web) | wouter |
| Routing (mobile) | Expo Router (file-based) |
| Server state | TanStack Query v5 |
| Backend | Express 5 |
| Database | PostgreSQL + Drizzle ORM |
| Auth | Clerk (`@clerk/react`, `@clerk/express`, `@clerk/expo`) |
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

### Web Frontend (`artifacts/happier-ai-vault/src/`)

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

### Mobile App (`artifacts/memory-machine-mobile/`)

```
app/
  _layout.tsx          — Root layout: Clerk, QueryClient, dark splash guard,
                         push notification bootstrap, SecureStore token cache
  index.tsx            — Landing/splash redirect
  sign-in.tsx          — Email+password sign-in (Clerk v3 API)
  sign-up.tsx          — Email+password sign-up + email verification
  (tabs)/
    _layout.tsx        — Tab bar (Vault + Settings); auth guard → /sign-in
    vault.tsx          — Thread list, profile switcher, import trigger
    settings.tsx       — API key, model, max context settings

  thread/[id].tsx      — Full-screen chat: streaming SSE, haptics, keyboard avoidance

components/
  ImportSheet.tsx      — Bottom-sheet ZIP/JSON import (5 MB chunked upload + SSE finalize)
  ProfileSwitcher.tsx  — Modal profile picker with sign-out
  ErrorBoundary.tsx    — Catches render throws, shows recovery screen

contexts/
  ProfileContext.tsx   — Active profile state + AsyncStorage persistence (storedProfileId)

hooks/
  useChatStream.ts     — SSE streaming via expo/fetch with StreamEvent union type
  useColors.ts         — Theme color map (dark palette, #1ad4be accent)
  useNotifications.ts  — Push notification permission + Expo token registration
  useMobile.tsx        — Breakpoint helper

app.json               — Bundle IDs, expo-notifications + expo-document-picker plugins
eas.json               — EAS build profiles (development/preview/production)
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
| POST | /api/import/chunk | Upload one chunk (multipart, field: "chunk") |
| POST | /api/import/finalize | Assemble chunks, parse, insert — streams SSE progress |

## Bulk Import (chunked upload + server-side streaming)

Triggered by the upload icon in the sidebar (web) or vault header (mobile). The file is split into chunks (10 MB web / 5 MB mobile); each chunk is uploaded independently before the server reassembles, parses, and inserts everything.

**Flow:**
1. User selects a `.zip` or `.json` file
2. File is sliced into chunks; each is POSTed to `POST /api/import/chunk` with `uploadId` (UUID v4), `chunkIndex`, `totalChunks`; a fresh Clerk token is fetched per chunk
3. Once all chunks are received, `POST /api/import/finalize` is called with `{ uploadId, totalChunks, isZip }` — server concatenates chunks, opens the ZIP with JSZip
4. `JSON.parse()` produces the full object; `extractConversations()` locates the conversation array
5. Conversations are parsed and batch-inserted to PostgreSQL in groups of 20
6. An SSE progress event is sent after every batch: `{ type: "progress", processed, imported, skipped }`
7. A final `{ type: "done", imported, skipped, errors }` event closes the stream
8. Temp files are deleted; the client refreshes the thread list

**`src/lib/import-stream.ts`** handles:
- ZIP archives and plain JSON files
- Top-level arrays and container objects (`conversations`, `chats`, `data`, `history`, `items`)
- Grok's `prod-grok-backend.json` format (`response.sender` / `response.message` fields)
- Various role names: `user`, `human`, `assistant`, `grok`, `ai`, `bot`
- Nested content: `.parts[]`, `.message.content`, author-as-object
- Aggressive fallback: scans ALL array-valued keys on conversation objects if known keys fail
- Batch DB inserts (20 threads + all their messages per query group)
- Postgres 65 535-parameter guard (chunked message inserts)
- Heartbeat comment frames every 8 s to keep the SSE connection alive through proxies
- 2 GB upload cap; iOS `application/octet-stream` MIME type detection for ZIPs

## Grok Streaming

`POST /api/threads/:id/stream` accepts `{ content: string }`, saves the user message first (so it always appears in UI even on error), fetches the user's xAI API key from settings, loads thread history, and calls `streamGrokCompletion()` from `lib/grok.ts`.

`streamGrokCompletion(apiKey, model, messages, callbacks)` calls `https://api.x.ai/v1/chat/completions` with `stream: true` and fires `onToken(delta)` for each chunk and `onDone(fullContent)` / `onError(message)` at completion.

Tokens are forwarded to the client via SSE (`data: { type: "token", content: "..." }`). On completion the assistant message is saved and `data: { type: "done", message: {...} }` is emitted. If no API key is set, a `user_message` event is emitted first (so the bubble appears), then an `error` event.

The stream route respects `maxContextMessages` from the user's settings:
- `0` → send the **full conversation history** (no limit)
- `1–1000` → send only the last N messages (`history.slice(-N)`)

## Mobile App — Key Design Decisions

### Auth
- Clerk `@clerk/expo` with `tokenCache` backed by `expo-secure-store` — sessions persist across cold launches on both iOS and Android
- Tab layout (`(tabs)/_layout.tsx`) has an auth guard: redirects to `/sign-in` if `!isSignedIn`

### Profile Restoration
- Active profile ID saved to `AsyncStorage` on every switch
- On app start, `ProfileContext` exposes `storedProfileId`; vault matches it against loaded profiles before defaulting to `profiles[0]`

### Push Notifications
- `hooks/useNotifications.ts` requests permission, acquires Expo push token, and wires foreground + response listeners on every session start
- Config plugin registered in `app.json` (icon, color, default channel)

### Chunked Import (Mobile)
- `expo-file-system` reads 5 MB slices via `position + length` options
- Each slice uploaded with a fresh Clerk token; AbortController cancels in-flight requests on user cancel
- ZIP detection by file extension (`.zip`) not MIME type (MIME is unreliable from iOS picker)

### Startup
- `SplashScreen.preventAutoHideAsync()` holds the splash until fonts load
- While fonts are loading, a dark `View` (`#2f2f37`) is shown so no white flash occurs
- `app.json` has `backgroundColor: "#2f2f37"` to match the OS-level background

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

- **Theme**: Medium grey background (`hsl(240 8% 20%)` / `#2f2f37`), white text, neon minty aqua (`hsl(174 85% 52%)` / `#1ad4be`) accent — like the Statue of Liberty patina shifted cooler
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

**Note**: The web frontend uses `CLERK_PUBLISHABLE_KEY` exposed via `vite.config.ts` `define` (as `VITE_CLERK_PUBLISHABLE_KEY`). Do NOT use `publishableKeyFromHost()` — it generates `clerk.localhost` URLs in the dev proxy context.

The mobile app dev workflow injects `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_DOMAIN=$REPLIT_DEV_DOMAIN` automatically.

## Known Bugs Fixed

- **Thread list empty after navigation** — `zod.coerce.boolean()` coerces the string `"false"` to `true`, so `?archived=false` was querying for archived threads. Fixed by manually converting the string before Zod parsing in the threads route.
- **Thread list not refreshing after create** — HTTP 304 responses from server cache were hiding new threads. Fixed by adding `Cache-Control: no-store` middleware for all `/api` routes, and using `refetchType: "all"` in query invalidation.
- **Clerk JS failing to load** — `publishableKeyFromHost(hostname, key)` was generating `clerk.localhost` URLs via the dev proxy. Fixed by using the raw `CLERK_PUBLISHABLE_KEY` directly.
- **Vault layout overflowing on mobile (web)** — sidebar was a fixed `w-80` (320px) with the chat area alongside it, causing overflow on phones (390px screen). Fixed with a full-screen panel toggle.
- **ZIP import crashing on mobile / "not fetching"** — Browser-side parsing of a 379 MB ZIP required loading the full archive into RAM, killing the tab on low-memory devices. Fixed by moving all parsing to the server with chunked upload.
- **Import dialog closing immediately on Android (web)** — Android fires `onOpenChange(false)` the instant the file picker sheet opens. Fixed with `filePickerOpenRef` + `window focus` event.
- **Import showing "done, 0 saved"** — Parser format mismatch. Fixed by refactoring `import-stream.ts` into a `tryExtractMessages()` helper with an aggressive fallback.
- **SSE connection drop UX** — Long imports through a mobile network could silently stall. Fixed by reducing heartbeat interval to 8 s and adding an `interrupted` phase in the dialog.
- **Duplicate messages on network retry** — `setQueryData` could append the same message twice if an SSE event was replayed. Fixed by deduplicating on message ID.
- **White-screen crash on bad data** — No React Error Boundary. Fixed by adding `ErrorBoundary` wrapping the whole app in `App.tsx`.
- **Date parsing crash in chat area** — `format(new Date(msg.createdAt), ...)` throws on invalid dates. Fixed with `isValid()` guard.
- **Delete vault caused full page reload on mobile (web)** — `window.location.reload()` in `handleDelete`. Fixed with `onDeleted` prop on `ChatArea`.
- **Thread search was in-memory (slow at scale)** — Fixed by pushing the filter into SQL via Drizzle's `ilike()`.
- **Silent cleanup failures in import finalize** — Empty callbacks swallowed `fs.rm`/`fs.unlink` errors. Fixed by logging warnings.
- **Grok export format: 0 conversations imported** — Parser missed `{ "response": { "message": "...", "sender": "human" } }` wrapper. Fixed in `tryExtractMessages()` by checking `msg.response` as inner candidate.
- **User message disappearing on API key error (API server)** — The stream route checked for the API key before saving the user message, so if no key was set the message was never stored. Fixed: user message is saved first, then API key is checked; if missing, emits `user_message` + `error` SSE events so the bubble appears with an error banner.
- **Mobile SSE error events silently swallowed** — Error events were caught inside the JSON parse try/catch and discarded. Fixed with isolated parse try/catch and discriminated `StreamEvent` union; reads both `event.error` and `event.content` for compatibility.
- **Mobile sessions not persisted (Android cold launch)** — `tokenCache` was not wired to `ClerkProvider`. Fixed by adding `expo-secure-store`-backed `tokenCache` in `_layout.tsx`.
- **Mobile import: wrong multer field name** — Client was sending field `"file"` but server expects `"chunk"`. Fixed.
- **Mobile import: invalid uploadId format** — Server validates UUID v4; client was generating `"mob-${Date.now()}-..."`. Fixed with `Crypto.randomUUID()`.
- **Mobile import: missing `totalChunks` + `isZip` in finalize body** — Server needs both fields. Fixed.
- **expo-file-system v55 breaking change** — `readAsStringAsync` and `getInfoAsync` moved to `expo-file-system/legacy`. Import updated in `ImportSheet.tsx`.
- **Blank frame on cold start (mobile)** — Missing `backgroundColor` in `app.json` top-level config caused a light flash during OS splash transition. Fixed by adding `"backgroundColor": "#2f2f37"`.

## Security Scan Results (last run: May 13 2026)

### Dependency Audit — 0 critical, 0 high, 0 moderate

No actionable vulnerabilities in project dependencies. All previously reported findings remain remediated.

### SAST — 0 findings in application code

All HIGH/CRITICAL SAST findings are in `.agents/skills/` third-party skill scripts (brainstorming helper, docx processor) — none are in application source code. No findings in `artifacts/`, `lib/`, or `scripts/`.

### HoundDog — 0 findings

### Expo Package Versions
Corrected to match Expo SDK 54 expected ranges:
- `expo-document-picker` → `~14.0.8`
- `expo-file-system` → `~19.0.22`
- `expo-notifications` → `~0.32.17`

## E2E Test Results (last run: May 13 2026)

Three full passes — all flows tested and green:

**Run 1 — Core web vault flow:**
- Clerk programmatic sign-in, redirect to /vault
- Sidebar visible, new thread creation ("New Memory" button)
- Message sent → user bubble appears, input clears
- Settings page (API key, model, context fields visible)
- Thread persists in sidebar after navigation
- Thread archive + delete (via dropdown), confirmation dialog handled

**Run 2 — Archive, search, stats, import dialog:**
- Archive thread → disappears from active list → visible under Archived filter
- Search input filters thread list; clearing restores full list
- Vault Statistics dialog opens and shows counts
- Import dialog opens (upload icon), shows "Choose File", closes cleanly

**Run 3 — Settings persistence + 404:**
- Settings save (max context = 50) → page reload → field persists at 50
- Reset to 0 saves without error
- Navigation to `/this-page-does-not-exist` shows 404 page (no crash)

## Workflows

| Name | Command | Port |
|---|---|---|
| API Server | `pnpm --filter @workspace/api-server run dev` | 8080 |
| Happier AI Vault (web) | `pnpm --filter @workspace/happier-ai-vault run dev` | 5173 |
| Memory Machine (mobile) | `pnpm --filter @workspace/memory-machine-mobile run dev` | Expo QR |
| Component Preview Server | `pnpm --filter @workspace/mockup-sandbox run dev` | 8081 |
