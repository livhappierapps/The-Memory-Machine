---
name: mobile-tsconfig-quirks
description: Mobile package (Expo SDK 54 + pnpm monorepo) tsconfig needs all compiler options inlined — expo/tsconfig.base cannot be resolved by tsc in this workspace setup.
---

# Mobile tsconfig quirks

## The rule

`artifacts/memory-machine-mobile/tsconfig.json` must NOT use `"extends": "expo/tsconfig.base"`. That path cannot be resolved by `tsc` in the pnpm monorepo because `expo` is not symlinked at the root `node_modules` and pnpm's virtual store path is not on TypeScript's lookup chain.

**Why:** Expo's dev server auto-patches the tsconfig on startup and adds `"extends": "expo/tsconfig.base"` to the bottom of the file. This is harmless at runtime (Metro ignores it), but causes `tsc --noEmit` to fail with `TS6053: File 'expo/tsconfig.base' not found`. Keep the explicit inline settings — they win over the appended extends.

## Required compiler options (must be explicit)

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext", "DOM"],
    "allowJs": true,
    "jsx": "react-native",
    "noEmit": true,
    "isolatedModules": true,
    "strict": true,
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  }
}
```

`skipLibCheck: true` alone is not enough — expo-file-system/legacy ships `.ts` source files that fail without `lib: ["ESNext"]`.

## Ambient shims for unresolvable expo modules

`artifacts/memory-machine-mobile/types/missing-modules.d.ts` declares `expo` and `expo/fetch` because pnpm does not create a symlink for the bare `expo` package in the mobile app's local `node_modules` (only `expo-*` subpackages are symlinked there). Include `"types/**/*.d.ts"` in the tsconfig `include` array.

## pnpm crypt@0.0.2 store issue

If Metro crashes with `ENOENT: watch '.../crypt_tmp_*'` — a stale temp file was left by a failed pnpm install inside the `crypt@0.0.2` pnpm store entry.

**Fix — delete only the temp file, NOT the whole package:**
```bash
rm -f /home/runner/workspace/node_modules/.pnpm/crypt@0.0.2/node_modules/crypt_tmp_*
```

If the whole `crypt@0.0.2` directory was already deleted, restore it:
```bash
mkdir -p /home/runner/workspace/node_modules/.pnpm/crypt@0.0.2/node_modules/crypt
cd /tmp && curl -sL https://registry.npmjs.org/crypt/-/crypt-0.0.2.tgz | tar xz
cp -r package/* /home/runner/workspace/node_modules/.pnpm/crypt@0.0.2/node_modules/crypt/
# Also recreate the expo binary symlink
EXPO_CLI_DIR=$(ls /home/runner/workspace/node_modules/.pnpm/ | grep "@expo+cli@54.0.24" | head -1)
ln -sf "/home/runner/workspace/node_modules/.pnpm/$EXPO_CLI_DIR/node_modules/@expo/cli/build/bin/cli" \
  /home/runner/workspace/artifacts/memory-machine-mobile/node_modules/.bin/expo
ln -sf "/home/runner/workspace/node_modules/.pnpm/$EXPO_CLI_DIR/node_modules/@expo/cli/build/bin/cli" \
  /home/runner/workspace/node_modules/.bin/expo
```

**Why this matters:** `crypt` is a Metro + @expo/cli transitive dependency. Deleting the whole package corrupts pnpm's virtual store and breaks `pnpm exec expo` (binary lookup fails). Deleting only `crypt_tmp_*` is safe.
