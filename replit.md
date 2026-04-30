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
| POST | /api/threads/:id/messages | Save a user message |
| POST | /api/threads/:id/stream | Stream Grok response via SSE |
| POST | /api/threads/:id/import | Import messages (JSON or plain text) |
| GET | /api/threads/:id/export | Export thread (json or markdown) |
| GET | /api/settings | Get user settings |
| PUT | /api/settings | Update user settings |
| GET | /api/stats | Get vault stats (thread/message counts) |
| POST | /api/import/zip | Bulk import Grok ZIP archive — multipart upload, SSE progress stream |

## Bulk ZIP Import

`POST /api/import/zip` accepts a multipart form upload (field name: `file`, max 1 GB). It requires a Clerk `Authorization: Bearer <token>` header. It:

1. Saves the file to `/tmp` via multer disk storage
2. Opens the ZIP with JSZip and reads every `.json` file inside
3. Parses conversations using a flexible parser that handles top-level arrays, `{conversations:[...]}` containers, mapping formats, and nested content (`.parts[]`)
4. Streams SSE progress events back: `status`, `total`, `progress`, `done`, `error`
5. Batch-inserts each conversation as a thread + messages into PostgreSQL
6. Cleans up the temp file when done

### Frontend (`BulkImportDialog`)

Triggered by the folder-archive icon button in the sidebar. Supports drag-and-drop and file picker. Shows:
- Drop zone → upload phase → live progress bar (X/Y conversations, last imported title) → done summary

## Grok Streaming

`POST /api/threads/:id/stream` accepts `{ content: string }`, saves the user message, fetches the user's xAI API key from settings, loads thread history, and calls `https://api.x.ai/v1/chat/completions` with `stream: true`. Tokens are streamed back via SSE (`data: { type: "token", content: "..." }`). On completion, the assistant message is saved and `data: { type: "done", message: {...} }` is emitted.

The stream route respects `maxContextMessages` from the user's settings:
- `0` → send the **full conversation history** (no limit)
- `1–1000` → send only the last N messages (`history.slice(-N)`)

This controls how much context Grok receives, which affects both response quality and API token usage.

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

## Security Scan Results (last run: April 30 2026)

- **Dependencies**: 0 critical, 4 high, 7 moderate (from pnpm audit — no action needed for dev; review before production deploy)
- **SAST**: 1 medium finding (unsafe dynamic method — internal framework usage, not user-facing)
- **HoundDog**: 0 findings

## Workflows

| Name | Command | Port |
|---|---|---|
| API Server | `pnpm --filter @workspace/api-server run dev` | 8080 |
| Happier AI Vault (web) | `pnpm --filter @workspace/happier-ai-vault run dev` | 5173 |
| Component Preview Server | `pnpm --filter @workspace/mockup-sandbox run dev` | 8081 |
