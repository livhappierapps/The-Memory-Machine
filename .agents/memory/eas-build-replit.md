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

- Account: `livhappier`
- Slug: `the-memory-machine` (must match `app.json` slug — was previously mismatched as `thememorymachinemobile`)
- projectId: `d3cebcea-7cb8-4a32-8b53-c19e8a1557da` (in `app.json` → `extra.eas.projectId`)

**Why slug matters:** EAS validates that `app.json` slug matches the registered project slug. If they diverge, the build errors with "Slug for project does not match". The fix is to update `app.json` slug to match what's shown on expo.dev.

## Free plan quota

- Limited monthly Android builds (resets 1st of each month)
- Upgrade at: expo.dev/accounts/livhappier/settings/billing
- Check build status: `npx eas-cli build:list --platform android --limit 5`

## Known Gradle failure (build bae40d16, July 2 2026)

First build errored with `EAS_BUILD_UNKNOWN_GRADLE_ERROR`. Logs expired before root cause confirmed. If this recurs after quota resets, check expo.dev build logs → "Run gradlew" phase for the specific Gradle error. Possible causes: New Architecture (`newArchEnabled: true`) compatibility with a native module.
