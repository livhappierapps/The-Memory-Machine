---
name: EAS Android build on Replit
description: How to trigger EAS builds from Replit's sandbox; required flags; reanimated 4.x New Arch requirement; expo-glass-effect Android incompatibility.
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

## Reading build logs

EAS log URLs expire in ~15 min. Get fresh URL via `npx eas-cli build:view <id> --json` (field: `logFiles[]`).

Log files are NDJSON (newline-delimited JSON). Fetch with Node.js `https.get` — each line is `{"msg":"...","phase":"RUN_GRADLEW",...}`. Do NOT use curl/grep/strings:

```js
node -e "
const https = require('https'), url = '<logUrl>';
https.get(url, res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    d.split('\\n').filter(Boolean).forEach(l => {
      try { const j = JSON.parse(l); if (j.msg) console.log(j.msg); } catch{}
    });
  });
});
"
```

## ⚠️ react-native-reanimated 4.x — REQUIRES New Architecture

**react-native-reanimated 4.x (and react-native-worklets) REQUIRES `newArchEnabled: true`.**
It will throw `assertNewArchitectureEnabledTask FAILED` if New Architecture is disabled.
**Never set `newArchEnabled: false` with reanimated 4.x.**

**Why:** Reanimated 4 dropped the old bridge architecture entirely. New Architecture (JSI/TurboModules) is mandatory. `react-native-worklets` is a required peer dep of reanimated 4.x — do not try to remove it.

## ⚠️ expo-glass-effect — iOS only, breaks Android builds

`expo-glass-effect` has no `expo-module.config.json` and is iOS-only. Including it in package.json causes Android Gradle/autolinking failures. **Do not add it back.** Replace `isLiquidGlassAvailable()` with `Platform.OS === 'ios'` checks.

## Expo project details

- Account: `livhappierapps` (remade July 2026 — old account `livhappier` is gone)
- Slug: `the-memory-machine`
- projectId: `50517425-e4fe-4baf-8967-11881ece7adb` (in `app.json` → `extra.eas.projectId`)
- accountId: `1fab176d-47e6-48c3-8935-b29099032a52`

**Why slug matters:** EAS validates that `app.json` slug matches the registered project slug. If they diverge, the build errors with "Slug for project does not match".

## Free plan quota

- Limited monthly Android builds (resets 1st of each month)
- Check build status: `npx eas-cli build:list --platform android --limit 5`

## Re-linking after account recreation

`eas-cli init --non-interactive` does NOT work in Replit (exits -1). Use GraphQL API:
1. Get accountId: `curl -X POST https://api.expo.dev/graphql -H "Authorization: Bearer $TOKEN" -d '{"query":"{ me { accounts { id name } } }"}'`
2. Create project: mutation `app { createApp(appInput: { accountId, projectName }) { id } }`
3. Update `app.json` → `extra.eas.projectId` with new id

## Build history

| Build | Result | Notes |
|---|---|---|
| bae40d16 | ERRORED | Old account; expo-glass-effect present; logs expired |
| c097a361 | ERRORED | New account; expo-glass-effect still present |
| fb427d75 | ERRORED | newArchEnabled: false — reanimated 4.x requires New Arch; error was assertNewArchitectureEnabledTask |
| 6c272caf | IN_PROGRESS | newArchEnabled: true + expo-glass-effect removed — first clean combo |
| (none) | BLOCKED | 2026-10-01 Automations re-trigger to replace expired emailed link. No Replit shell in this runtime; EXPO_TOKEN unset; GitHub app cannot read Actions secrets; expo.dev builds page requires login. GraphQL createAndroidBuild not called. No APK URL, no email. |
| (none) | BLOCKED | 2026-10-04 re-triggered to replace expired emailed link. Same blocker: no Replit shell, EXPO_TOKEN unset, expo.dev login wall. Fallback: GitHub Actions android-apk.yml. Run 16 (37200428355) FINISHED success; artifact memory-machine-mobile-debug-apk id 11304045386, expires 2026-10-18. Run 17 (37206771761) already in progress. Run 18 (37209202480) queued by this re-trigger. Link posted on issue #3. No email (no mail connector). |
