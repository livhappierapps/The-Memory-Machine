# Leo's Crash Pad — start without Replit

This pad does not need Replit to breathe.

From repo root:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
cd artifacts/leo-app
pnpm exec expo start --tunnel --clear
```

Scan the **new** QR in Expo Go (SDK 54). Do not reuse an old Replit QR.
In the phone dev menu: Disable Fast Refresh, then Reload.

Keys stay on the phone (SecureStore). Vault URL + MCP token are optional until Memory Machine is reachable.

First Android APK off this machine:

```bash
cd artifacts/leo-app
npx eas-cli@latest login
npx eas init
npx eas build --platform android --profile preview --non-interactive
```
