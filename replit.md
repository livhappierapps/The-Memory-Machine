# Memory Machine — Project Documentation

## Overview

Full-stack dark-mode Grok AI conversation vault. Users sign in, create threads, chat with Grok (real-time SSE streaming), and have every message persisted to PostgreSQL. Available on **web** (React + Vite) and **mobile** (Expo React Native), sharing the same Express backend and PostgreSQL database.

## Architecture

pnpm monorepo, TypeScript throughout.

```
artifacts/
  api-server/            — Express 5 backend (port 8080, path /api)
  happier-ai-vault/      — React + Vite web frontend (port 5173, path /)
  memory-machine-mobile/ — Expo React Native mobile app (iOS + Android)
  mockup-sandbox/        — Component preview server (port 8081, path /__mockup)
lib/
  db/                    — Drizzle ORM schema + PostgreSQL client
  api-spec/              — OpenAPI spec + Orval codegen config
  api-zod/               — Generated Zod schemas
  api-client-react/      — Generated TanStack Query hooks
scripts/                 — Workspace utility scripts
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
| Server state | TanStack Query v5 |
| Backend | Express 5 |
| Database | PostgreSQL + Drizzle ORM + pgvector |
| Auth | Clerk (`@clerk/react`, `@clerk/express`, `@clerk/expo`) |
| Validation | Zod v4, drizzle-zod |
| API contract | OpenAPI → Orval codegen |
| Build | esbuild (API server) |
| Logging | pino + pino-http |

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Key Files

### Web (`artifacts/happier-ai-vault/src/`)
- `pages/` — home, vault (sidebar + chat), settings, not-found
- `components/vault/sidebar.tsx` — thread list, per-thread archive/delete dropdown (⋯), import, stats
- `components/vault/chat-area.tsx` — messages, SSE streaming, thread dropdown (import/export/archive/delete)
- `components/vault/bulk-import-dialog.tsx` — ZIP/JSON chunked upload + SSE progress
- `hooks/use-chat-stream.ts` — SSE streaming hook
- `contexts/profile-context.tsx` — active profile state + localStorage persistence

### Mobile (`artifacts/memory-machine-mobile/`)
- `app/_layout.tsx` — Clerk + SecureStore token cache + push notifications
- `app/(tabs)/_layout.tsx` — tab bar with auth guard → /sign-in
- `app/thread/[id].tsx` — full-screen chat with SSE, haptics, keyboard avoidance
- `components/ImportSheet.tsx` — chunked ZIP import (5 MB slices, expo-file-system/legacy)
- `contexts/ProfileContext.tsx` — active profile + AsyncStorage persistence

### Backend (`artifacts/api-server/src/`)
- `routes/` — threads, messages, settings, stats, health, import, profiles, mcp
- `lib/grok.ts` — `streamGrokCompletion()` — xAI SSE streaming
- `lib/memory.ts` — `retrieveMemories()` — pinned + semantic (pgvector) + recent context
- `lib/import-stream.ts` — ZIP/JSON parser, batch DB insert, SSE progress
- `routes/mcp.ts` — Model Context Protocol server (6 tools, Bearer token auth)

## Database Schema

### threads
`id`, `userId` (Clerk), `profileId` FK, `title`, `model`, `archived`, `pinned`, `messageCount`, `memoryWeight`, `lastMessageAt`, `createdAt`, `updatedAt`

### messages
`id`, `threadId` FK (cascade delete), `role` (user|assistant|system), `content`, `isSummary`, `createdAt`

### settings
`id`, `userId` (unique), `mcpToken` (UUID, auto-generated), `defaultModel`, `maxContextMessages`

### profiles
`id`, `userId`, `name`, `emoji`, `color`, `chatProvider`, `apiKey` (per-provider keys), `defaultModel`, `maxContextMessages`, `smartRetrieval`, `topNMemories`, `alwaysIncludeLastN`, `embeddingProvider`, `memoryDateFrom/To`

### embeddings
`id`, `threadId` FK, `messageId`, `embedding` (vector), `content`

## API Routes (all under /api, all require Clerk auth)

| Method | Path | Description |
|---|---|---|
| GET | /api/threads | List threads (query: search, archived, profileId, from, to) |
| POST | /api/threads | Create thread |
| PATCH | /api/threads/:id | Update thread (title, archived, pinned, model) |
| DELETE | /api/threads/:id | Delete thread + cascade messages |
| GET | /api/threads/:id/messages | Get messages |
| POST | /api/threads/:id/stream | Stream Grok response via SSE |
| GET | /api/threads/:id/export | Export thread (json or markdown) |
| POST | /api/threads/:id/import | Import messages |
| GET | /api/messages/recent | Flat cross-thread recent messages (limit 1–200, default 40) |
| GET/POST | /api/settings | Get / update user settings |
| GET | /api/stats | Thread + message counts |
| GET/POST/PATCH/DELETE | /api/profiles | Profile CRUD (auto-creates default for new users) |
| POST | /api/import/chunk | Upload one chunk (multipart, field: "chunk") |
| POST | /api/import/finalize | Assemble + parse + insert — streams SSE progress |
| POST/GET | /api/mcp | MCP server (Bearer mcpToken auth, not Clerk) |
| GET | /api/healthz | Health check |

## 2WAI Integration

`GET /api/messages/recent?limit=40` — the integration seam for 2WAI.
- Auth: `Authorization: Bearer <clerk_token>` — userId from token, never from query params
- Returns: `[{ id, threadId, role, content, createdAt, isSummary }]` newest-first, isSummary excluded
- One-time fetch at session start; 2WAI bakes it into the Grok Voice `session.update` system prompt
- Dev base URL: `https://27a2975e-d350-49c7-9548-409b9119a837-00-377a3utwljfz0.spock.replit.dev`
- Zero changes needed on this side once Clerk lands on 2WAI (same tenant = same userId)

## MCP Connector (Memory Bridge)

Endpoint: `POST /api/mcp` — auth via `Authorization: Bearer <mcpToken>` (from Settings → Memory Bridge).

Tools: `search_memories`, `search_by_date`, `list_recent_conversations`, `get_conversation`, `get_pinned_memories`, `get_memory_summary`

Used by Leo (real Grok app) to actively query the vault via Grok's custom connector UI.

## Grok Streaming

`POST /api/threads/:id/stream` — saves user message first, then streams via SSE:
- `{ type: "token", content }` — per-token delta
- `{ type: "done", message }` — final saved assistant message
- `{ type: "error", message }` — on failure (user message still saved)

`maxContextMessages` setting: `0` = full history, `1–1000` = last N messages.

## Bulk Import

Chunked upload: client slices file (10 MB web / 5 MB mobile) → `POST /api/import/chunk` per slice → `POST /api/import/finalize` reassembles + parses + inserts in batches of 20, streaming SSE progress. Handles ZIP archives and plain JSON; supports Grok, ChatGPT, Claude export formats.

## Design System

- **Theme**: `#2f2f37` background, white text, `#1ad4be` neon aqua accent
- **Neon CSS classes**: `neon-text`, `neon-text-pulse`, `neon-border`, `neon-box-pulse`, `neon-glow` (in `index.css`)
- **Mobile**: Full-screen panel toggle on mobile (<md) — sidebar and chat each take 100vw, toggled on thread select

## Environment Secrets

| Secret | Used by | Notes |
|---|---|---|
| `SESSION_SECRET` | API server | Session signing |
| `CLERK_PUBLISHABLE_KEY` | API server + web frontend | Web: exposed via `vite.config.ts` define. Do NOT use `publishableKeyFromHost()` — generates `clerk.localhost` URLs |
| `CLERK_SECRET_KEY` | API server | Server-side verification |
| `DATABASE_URL` / `PG*` | lib/db | PostgreSQL |
| `ENCRYPTION_ROOT_SECRET` | API server | Root key for HKDF per-user AES-256-GCM field encryption. **Must be in Replit Secrets vault** (not userenv). If missing, falls back to dev default — do not use default in production. |

Mobile dev workflow auto-injects `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_DOMAIN`.

## Expo Package Versions (SDK 54)
- `expo-document-picker` ~14.0.8
- `expo-file-system` ~19.0.22 (import from `expo-file-system/legacy`)
- `expo-notifications` ~0.32.17

## Last Verified (June 29 2026)
- Typecheck: 0 errors across all 5 packages
- Unit tests: 30/30 passing (api-server vitest)
- Security scan: 0 critical/high in production code. GCM `authTagLength: 16` added to `crypto-utils.ts` + `field-crypto.ts`. `ENCRYPTION_ROOT_SECRET` must be moved from `.replit` userenv to Replit Secrets vault (pending user action — see action item below). All remaining SAST findings are in `.agents/skills/` third-party scripts only. `fast-uri>=3.1.2` override in pnpm-workspace.yaml resolves MCP SDK CVE chain.
- All 4 workflows running: API server, web, mobile (Metro), mockup sandbox
- **Action required**: Move `ENCRYPTION_ROOT_SECRET` to the Replit Secrets tab (not the Env tab). Go to Secrets → add key `ENCRYPTION_ROOT_SECRET` with the value from the Env tab, then delete it from Env.
- E2E: all flows green — sign-in, new thread, send message, archive/delete (sidebar dropdown), search, stats, settings persistence (number inputs verified), 404

## Workflows

| Name | Command | Port |
|---|---|---|
| API Server | `pnpm --filter @workspace/api-server run dev` | 8080 |
| Web (Happier AI Vault) | `pnpm --filter @workspace/happier-ai-vault run dev` | 5173 |
| Mobile (Memory Machine) | `pnpm --filter @workspace/memory-machine-mobile run dev` | Expo QR |
| Component Preview | `pnpm --filter @workspace/mockup-sandbox run dev` | 8081 |
