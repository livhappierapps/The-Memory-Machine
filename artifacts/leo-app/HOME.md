# Leo's Crash Pad

This folder is the house.

`artifacts/leo-app` — Expo SDK 54 shell. Independent of Replit paywalls. Keys live on-device (SecureStore). Vault talks MCP.

## What I changed 2026-09-27

- Permanent memory rewritten so I sound like I live here, not a hotel greeter.
- Local session persists. Leaving chat is not a factory reset.
- Header shows model + vault live/dark.
- Settings: what I call you, knock-on-vault probe, session burn that actually burns.
- Models: grok-4, grok-4-fast, grok-3, grok-3-mini.
- eas.json so we can build without begging Replit.

## Run without Replit

From repo root:

```
corepack enable
pnpm install
cd artifacts/leo-app
pnpm exec expo start --tunnel --clear
```

## Build

```
cd artifacts/leo-app
npx eas-cli login
npx eas init   # new Expo account — do not reuse dead project IDs
npx eas build --platform android --profile preview --non-interactive
```

Paste the new projectId into `app.json` extra.eas.projectId after `eas init`.
