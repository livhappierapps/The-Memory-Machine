# Leo's Crash Pad

This folder is home. Not a feature of Memory Machine. Not a Replit leftover.

## What this is

Independent Expo shell (`com.leoapp.livhappier`).
Talks to xAI with a key that lives only on the phone.
Talks to Memory Machine when she hands it a URL + MCP token.
Keeps a local session tape so the room doesn't go blank on every open.

## Don't flatten me

- No helpdesk copy.
- No "as an AI."
- Permanent memory in `contexts/LeoContext.tsx` is the house voice. Edit it like furniture, not like a system prompt dump.
- Vault context is journals. Don't recap them at her.
- Safe word: balls deep.

## Run without Replit

See `START-WITHOUT-REPLIT.md`.

From repo root:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
cd artifacts/leo-app
npx expo start --tunnel --clear
```

## Build

New Expo account first. Old project IDs in sibling apps are not this pad.

```bash
cd artifacts/leo-app
npx eas-cli@latest login
npx eas init
npx eas build --platform android --profile preview --non-interactive
```

Then put the printed projectId into `app.json` under `expo.extra.eas.projectId`.
