# The Memory Machine

## Scope and working rules

- This workspace is for the **public Memory Machine**: web app, public iOS/Android app, shared API, storage and cross-app memory connections.
- Freeze new features while resolving release blockers. No new project tasks or follow-up task proposals.
- Minimize cost: targeted searches, batched checks, reuse signing and existing infrastructure. Do not start paid builds, subscriptions or paid AI processing without approval.
- Preserve user memories, original uploads, existing encryption keys and signing identities. Never claim historical backups have been erased by source cleanup.
- Give the user one unavoidable action at a time, with the exact URL and button.
- Do not claim device testing, store submission, approval, or independence from Replit without evidence.

## Active source

| Directory | Purpose |
| --- | --- |
| `artifacts/api-server` | Express API, Clerk authentication, memory import/retrieval, MCP and OAuth |
| `artifacts/memory-machine` | Public React/Vite web app (`@workspace/memory-machine`) |
| `artifacts/memory-machine-mobile` | Public Expo iOS/Android app |
| `artifacts/mockup-sandbox` | Development-only component previews |
| `lib/db` | PostgreSQL/Drizzle schema and database client |
| `lib/api-spec` | OpenAPI contract and Orval code generation |
| `lib/api-zod`, `lib/api-client-react` | Generated validation/client packages |

## Commands

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server test:unit
pnpm --filter @workspace/api-spec codegen
node --test scripts/tests/*.test.cjs
pnpm --filter @workspace/memory-machine-mobile exec tsx --test utils/api-origin.test.ts
```

The default API tests use the configured development database and temporary fixtures. Do not point them at production. API deployment builds currently run these tests before bundling.

Use the existing managed workflows to run previews. Never start a second Metro server for the same app. Do not directly edit artifact manifests.

## Configuration and persistence

Environment **names only**:

- API: `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `SESSION_SECRET`, `ENCRYPTION_ROOT_SECRET`, optional `CLERK_WEBHOOK_SECRET`.
- Web build: `VITE_CLERK_PUBLISHABLE_KEY` or `CLERK_PUBLISHABLE_KEY`, `PORT`, `BASE_PATH`.
- Mobile build: `EXPO_PUBLIC_DOMAIN`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`.

Never rotate `ENCRYPTION_ROOT_SECRET` casually: existing memories depend on it. Database backups without the correct key are insufficient.

Mobile API addresses accept bare hosts or HTTPS origins, normalized centrally. Native credentials belong in secure device storage, not source or chat.

## Connections

The public MCP endpoint is `/api/mcp`; OAuth discovery is served under `/.well-known/`. OAuth currently validates Grok/xAI client metadata and callbacks, not arbitrary AI applications. Bearer authentication is also supported.

Do not equate connecting a tool with automatic cross-app recall. The AI host must retrieve relevant memories and include them in its model context. Never promise access to a consumer chat account without a supported, authorized source.

See `docs/CONNECTING-AI-APPS.md` for research and compatibility gaps, and `docs/RELEASE-READINESS.md` for current evidence and blockers. Re-check live deployment metadata before giving a production URL.

## Release safety

- Keep the existing mobile bundle IDs, Expo project and signing identities.
- Local JavaScript exports do not prove native launch or successful sign-in on physical devices.
- APKs and IPAs still depend on their backend unless offline behavior is implemented. A custom URL alone does not remove a Replit hosting dependency.
- Native-store payments, privacy declarations, account deletion and actual device journeys require release verification.
- Keep handoff ZIPs, original uploads, old exports and research out of deployments. Audit tracked history before open-sourcing; ignoring a file does not remove old copies.
