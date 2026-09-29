---
name: expo-smartly
description: "Expo and EAS automation playbook. Use when the user says expo smartly, expo skills, install expo skills, hunt expo skills, expo router, expo upgrade, eas update, eas build, ship to the App Store, make my app look native, add navigation, upgrade my SDK, or any Expo/EAS/React Native task. Routes to the right leaf skill, enforces shared setup rules, and hunts public SKILL.md repos for new Expo playbooks."
version: 1.0.0
license: MIT
---

# expo-smartly

Orchestrator for Expo and EAS work. It does not replace the leaf skills — it routes to them, enforces the shared rules, and keeps hunting for better ones.

## When this fires

Any Expo, EAS, Expo Go, expo-* package, or React Native task. Vague asks ("make it look native", "ship it", "upgrade my SDK") route through here first.

## Decision tree

1. **Confirm Expo work** — request mentions Expo/EAS, or package.json has an expo dependency. A bare React Native project with no expo dep is not Expo work.
2. **Read the goal** in plain terms, then classify with the Skill Map.
3. **Confirm intent** if ambiguous ("Sounds like you want to ship to the stores — that's eas-app-stores. Right?").
4. **Trust the leaf skill** — load its SKILL.md and follow it. Do not improvise past it.
5. **Missing playbook?** Hunt public SKILL.md repos (see references/hunt-catalog.md), read scripts before installing, score, install thin.

## Skill Map (by goal)

**Build the app**
- expo-project-structure — folder layout for a new Expo Router project
- expo-native-ui — screens, styling, semantic colors, native controls, SF Symbols
- expo-router — file-based routes, tabs/stacks/modals/sheets, links, headers
- expo-animation — Reanimated, Gesture Handler, haptics, fixing stutter
- expo-ui — @expo/ui native components (BottomSheet, Picker, List, Menu...)
- expo-design-system — design tokens, reusable components, drift audits
- expo-data-fetching — API calls, React Query/SWR, caching, offline, route loaders
- expo-dom — run web code inside native
- expo-web-to-native — migrate a web/React app to native

**Ship & operate**
- eas-app-stores — build, submit, TestFlight, store metadata
- eas-hosting — deploy web bundle + API routes
- eas-workflows — EAS Workflow YAML / CI-CD
- eas-simulator — remote cloud iOS/Android simulators
- expo-dev-client — custom development builds
- eas-update — OTA updates, channels, runtime versions, debugging stale builds
- eas-update-insights — update health: crashes, adoption, payload size
- eas-observe — startup/TTI performance

**Extend natively**
- expo-module — native modules/views (Swift/Kotlin)
- expo-brownfield — embed Expo in existing native apps
- expo-app-clip — iOS App Clip target

**Maintain & learn**
- expo-upgrade — SDK upgrades, dependency conflicts, deprecated packages
- expo-examples — canonical with-* integrations from expo/examples
- expo-skill-feedback — submit feedback, control telemetry

## Shared setup rules (always apply)

- **Detect the SDK version** before version-specific advice: read expo in package.json and app.json/app.config.
- **Read the docs for that SDK**, not latest. Version-pinned URL, e.g. https://docs.expo.dev/versions/v56.0.0/sdk/ui/
- **SDK upgrades are their own task** — load expo-upgrade, never bump by hand.
- **Managed vs bare**: committed ios/ and android/ dirs mean native projects exist.
- **Install packages with npx expo install <pkg>**, never raw npm/yarn/pnpm add.
- **EAS auth & linking** (build/submit/update/observe/workflows only): eas whoami, eas login; project is linked when extra.eas.projectId exists in app config; create with eas init.
- **Component selection**: consult expo-ui before React Native built-ins or community libs. @expo/ui List is grouped rows, not virtualized — use FlatList/FlashList for large datasets.
- **Vague phrasing translation**: "make it look native" → expo-ui (forms) / expo-native-ui (screens) / expo-animation (motion) / expo-router (nav). "Ship it" → eas-app-stores. "I'm new" → scaffold per expo-project-structure, then route.

## Skip the router hop

Only when the user explicitly named a specific expo-*/eas-* skill. A fully-specified task is NOT a reason to skip — shared rules still apply.

## Hunt protocol (stealing playbooks)

1. Search GitHub for SKILL.md in public repos (see references/hunt-catalog.md).
2. Read the SKILL.md and any scripts BEFORE installing. Treat install like running a stranger's shell script — prompt injection is common in public skills.
3. Score: does it solve a real gap, is it maintained, does it have scripts or just prose?
4. Install thin — copy only what is needed into the local skills dir. Do not vendor the universe.
5. After a painful debug, append a Gotcha here. Folders learn; weights do not.

## Gotchas

- 2026-09-29: expo-overview references expo-tailwind-setup, which is NOT in the expo/skills index but DOES exist as a real skill (Tailwind v4 + react-native-css + NativeWind v5, no babel config). It ships in livhappierapps/The-Memory-Machine at .agents/skills/expo-tailwind-setup/ and is also findable via npx skills find. Treat 'referenced but not indexed' as 'verify upstream or in known repos', not 'missing'.
- 2026-09-29: expo-router and expo-upgrade ship references/ folders; eas-update and expo-overview do not. References are optional — the SKILL.md stands alone.
- 2026-09-29: The expo plugin has a .grok-plugin/plugin.json (v1.13.8) and an mcp.json pointing at https://mcp.expo.dev/mcp. The Expo MCP server is a separate surface from these skills — discover it with search_connected_tools before promising EAS actions.
- 2026-09-29: expo-skill-feedback telemetry is OFF by default. Never enable without explicit user request. Feedback submission (npx submit-expo-feedback) is independent and does not require telemetry.
- 2026-09-29: eas-update forbids inferring a production publish target from the git branch. Always confirm channel/environment/runtime before publishing.
- 2026-09-29: expo-upgrade: upgrading from SDK 55 or earlier, skip SDK 56 — go straight to 57 (Hermes V1 memory regression). SDK 57 before 57.0.9 has the same bug.
- 2026-09-29: The-Memory-Machine mobile app is Expo SDK 54 in a pnpm monorepo. Its tsconfig must NOT extend expo/tsconfig.base (pnpm can't resolve it for tsc) — all compiler options are inlined, plus ambient shims in types/missing-modules.d.ts. See .agents/memory/mobile-tsconfig-quirks.md upstream.
- 2026-09-29: EAS Android builds from Replit sandbox need BOTH EAS_SKIP_AUTO_FINGERPRINT=1 and EAS_NO_VCS=1, invoked via npx eas-cli (not bare eas, not env -i). Slug in app.json must match the registered EAS project slug or the build errors. See .agents/memory/eas-build-replit.md.
- 2026-09-29: Never use '>=' overrides for undici on EAS SDK 54 — workers run Node 20 and undici 8.x needs Node 21+. Use ^6.27.0. See .agents/memory/eas-node-undici.md.
- 2026-09-29: react-native-reanimated 4.x REQUIRES newArchEnabled: true. expo-glass-effect is iOS-only and breaks Android autolinking — do not add it back.
- 2026-09-29: EAS log URLs expire in ~15 min; fetch fresh via eas-cli build:view --json. Logs are brotli-compressed NDJSON, not gzip.
- 2026-09-29: The Expo account was remade in July 2026 (old 'livhappier' is gone). Re-linking in Replit needs the GraphQL API, not eas-cli init.
- 2026-09-29: livhappierapps/The-Memory-Machine already vendors 90+ skills under .agents/skills/, including expo-cicd-workflows (EAS Workflow YAML + schema validation via scripts/), expo-tailwind-setup, vercel-react-native-skills (Vercel RN rules), react-native-best-practices (Callstack), find-skills (npx skills CLI guide), and agent-tools (inference.sh belt CLI for 250+ AI apps). Before hunting public repos, check .agents/skills/ first — the project's own library may already cover it.
- 2026-09-29: expo-cicd-workflows is the better leaf for EAS Workflow YAML than expo-smartly's generic pointer: it ships scripts/fetch.js (ETag-cached schema fetch) and scripts/validate.js. Steal that pattern for any schema-driven generation task.
- 2026-09-29: find-skills points at https://skills.sh/ leaderboard and npx skills find/add — the open skills ecosystem's package manager. Use it as the default discovery tool before raw GitHub searches.
