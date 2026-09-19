# Sentry for Android (Leo + Memory Machine)

SDK: `@sentry/react-native` via the Expo config plugin. Crashes and JS errors go to Sentry after you set a DSN.

## You must do this once in Sentry

1. Create a free org at https://sentry.io (slug used in app.json: `livhappierapps`).
2. Create two React Native projects:
   - `leo-app`
   - `memory-machine`
3. Copy each project's **DSN**.
4. Settings → Auth Tokens → create a token with `project:releases` + `org:read` for source maps.

## Wire secrets (do not commit them)

CodeMagic → app → Environment variables / group `leo_secrets` and `memory_machine`:

- `EXPO_PUBLIC_SENTRY_DSN` = the DSN for that app
- `SENTRY_AUTH_TOKEN` = org auth token (source maps; optional for first debug APK)
- `SENTRY_ENVIRONMENT` = `production` or `debug`

If DSN is empty, Sentry stays disabled. The APK still builds.

## What shipped in git

- `artifacts/leo-app/sentry.ts` + `Sentry.wrap` on root layout
- `artifacts/memory-machine-mobile/sentry.ts` + wrap
- Expo plugin `@sentry/react-native/expo` in both `app.json`
- Metro `getSentryExpoConfig` for debug IDs / source maps

## Verify

After install, in any screen you can temporarily add:

```ts
import { Sentry } from "../sentry";
Sentry.captureException(new Error("sentry-smoke-test"));
```

You should see the event in that Sentry project within a minute if DSN is set.
