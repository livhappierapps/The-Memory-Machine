---
name: EAS Android build on Replit
description: How to trigger EAS builds from Replit's sandbox without git lock errors; slug alignment; free plan quota limits.
---

# EAS Android Build on Replit

## The command (run from `artifacts/memory-machine-mobile`)

```bash
EXPO_TOKEN=$(printenv EXPO_TOKEN) \
EAS_SKIP_AUTO_FINGERPRINT=1 \
EAS_NO_VCS=1 \
npx eas-cli build --platform android --profile preview --non-interactive --no-wait
```

Do NOT use `env -i` — npx wrapper script requires `XDG_CONFIG_HOME` and other env vars that `env -i` strips.
Do NOT use `eas` directly — it is not globally installed; use `npx eas-cli`.

**Why both flags are required:**
- `EAS_SKIP_AUTO_FINGERPRINT=1` — prevents a post-fingerprint git write that Replit's sandbox blocks (read-only .git in agent context)
- `EAS_NO_VCS=1` — stops EAS from acquiring a git index lock (also blocked by Replit sandbox)

**Why:** Without these flags, EAS attempts filesystem operations on `.git/` that are blocked in Replit's sandbox, causing the build command to fail immediately before even uploading.

**How to apply:** Any time a new EAS build needs to be triggered from within Replit. Credit to agent Dev (livhappier's other project agent) for discovering these flags.

## Expo project details

- Account: `livhappierapps` (remade July 2026 — old account `livhappier` is gone)
- Slug: `the-memory-machine`
- projectId: `50517425-e4fe-4baf-8967-11881ece7adb` (in `app.json` → `extra.eas.projectId`)
- accountId: `1fab176d-47e6-48c3-8935-b29099032a52`

**Why slug matters:** EAS validates that `app.json` slug matches the registered project slug. If they diverge, the build errors with "Slug for project does not match". The fix is to update `app.json` slug to match what's shown on expo.dev.

## Free plan quota

- Limited monthly Android builds (resets 1st of each month)
- Upgrade at: expo.dev/accounts/livhappier/settings/billing
- Check build status: `npx eas-cli build:list --platform android --limit 5`

## Re-linking after account recreation

If the expo.dev account is remade, the projectId in app.json becomes invalid ("Experience with id ... does not exist").
Re-link steps (all non-interactive, no git locks):
1. `eas-cli init --non-interactive` does NOT work in Replit (exits -1). Use GraphQL API instead.
2. Get accountId: `curl -X POST https://api.expo.dev/graphql -H "Authorization: Bearer $TOKEN" -d '{"query":"{ me { accounts { id name } } }"}'`
3. Create project: mutation `app { createApp(appInput: { accountId, projectName }) { id } }`
4. Update `app.json` → `extra.eas.projectId` with new id
5. Trigger build normally — keystore is auto-generated in cloud on first build

## Known Gradle failure (build bae40d16, July 2 2026)

First build on old account errored with `EAS_BUILD_UNKNOWN_GRADLE_ERROR`. Root cause never confirmed (logs expired). New account/project started fresh — keystore regenerated automatically.
