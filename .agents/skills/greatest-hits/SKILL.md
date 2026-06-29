---
name: greatest-hits
description: Run the full pre-release checklist for the Memory Machine project: security scan, test loop (fix until green), file cleanup/declutter, and README/replit.md refresh. Trigger when the user says "greatest hits", "run all checks", "make it shiny", "full check", "all clean", "clean build", "before handoff", "before launch", or "prep for release". Also trigger before any ZIP export, store submission, or major milestone.
---

# Greatest Hits — Full Pre-Release Suite

Four phases, run in order. Don't skip phases even if earlier ones look clean — each catches different things.

## Phase 1 — Security Scan

Read `.local/skills/security_scan/SKILL.md` and follow it fully. This runs three tools:
- `runDependencyAudit()` — known CVEs in npm deps
- `runSastScan()` — static analysis for secrets, injection, etc.
- `runHoundDogScan()` — secrets and credential leaks

**Fix anything critical or high** before moving to Phase 2. Medium/low findings: document them and move on unless they're obviously exploitable. Known safe override: `fast-uri>=3.1.2` in `pnpm-workspace.yaml` already resolves the MCP SDK CVE chain.

Note: `.agents/skills/` and `.local/skills/` contain third-party skill scripts — SAST findings inside those directories are not our code, ignore them.

## Phase 2 — Test Loop (fix until green)

Run all checks in parallel:

```bash
# Terminal 1
pnpm run typecheck

# Terminal 2  
pnpm --filter @workspace/api-server run test
```

Then use `refresh_all_logs` to check all 4 workflows are RUNNING.

**Score card format — always report this:**
```
TYPECHECK   ✅ 0 errors (5 packages)     ← or ❌ list the files+errors
UNIT TESTS  ✅ 30/30 passing             ← or ❌ list failures
API SERVER  ✅ RUNNING · DB bootstrap OK ← or ❌ check logs
WEB APP     ✅ RUNNING · Vite ready      ← or ❌
MOBILE      ✅ RUNNING · Metro ready     ← or ❌ see fixes below
MOCKUP      ✅ RUNNING                   ← or ❌
```

**Fix loop:** For each ❌, fix it, re-run only that check, update the score card. Repeat until all ✅. Don't move to Phase 3 until the score card is all green.

### Common fixes

**Mobile FAILED — ENOENT crypt_tmp_\***
```bash
rm -rf /home/runner/workspace/node_modules/.pnpm/crypt@0.0.2/node_modules/crypt_tmp_*
```
Then restart the mobile workflow.

**Mobile typecheck — "Cannot use JSX" / "Promise" / "esModuleInterop"**
The mobile `tsconfig.json` needs these in `compilerOptions`:
```json
"skipLibCheck": true,
"lib": ["ES2020", "DOM"],
"jsx": "react-native",
"esModuleInterop": true
```
`expo/tsconfig.base` does not reliably set these; add them explicitly.

**Typecheck errors after a merge — stale lib declarations**
```bash
pnpm run typecheck:libs   # rebuild first
pnpm run typecheck        # then full check
```

**Unit tests fail — unexpected import**
Check `artifacts/api-server/vitest.config.ts` for correct mock setup.

## Phase 3 — Clean, Organize, Declutter

Walk the repo structure and remove/consolidate dead weight. Check each area:

**Root**
- Remove any leftover `*.zip`, `*.bak`, `tmp_*`, `*.log` files
- Check `pnpm-workspace.yaml` catalog for unused overrides
- Confirm `tsconfig.base.json` refs only lib packages (not artifacts)

**artifacts/**
- Per-artifact: remove unused component files, dead imports, commented-out blocks >10 lines
- Check `dist/` folders aren't committed (should be in `.gitignore`)
- Remove any `.env.example` duplicates

**lib/**
- Confirm each lib has only files it actually uses
- Check for duplicate type definitions that should live in one place

**scripts/**
- Remove one-off migration scripts that have already run and won't run again (check with the user first before deleting — they may want the history)

**`.agents/skills/`**
- These are user skills, leave them alone unless explicitly asked

**Report what you removed** — list files deleted, don't silently drop things.

## Phase 4 — Update the Docs

Update these files to reflect current state:

**`replit.md`** — the project README. Update:
- "Last Verified" date to today
- Stack table if versions changed
- API Routes table if routes were added/removed
- Environment Secrets table if new secrets were added
- Any sections that are now inaccurate

**`.agents/memory/MEMORY.md`** — update the memory index if this run revealed new durable lessons (broken-symlink pattern, tsconfig quirks, etc.). Follow the memory writing rules: one-line bullet pointing to a topic file, no changelogs.

**`artifacts/memory-machine-mobile/app.json`** — if the mobile app version or permissions changed, bump `versionCode` and `version`.

## Done Criteria

The run is complete when:
- [ ] Security scan: 0 critical/high findings (or all documented+suppressed with reason)
- [ ] Score card: all 6 items ✅
- [ ] Cleanup report presented to user
- [ ] `replit.md` Last Verified date updated to today

Present the final score card + a one-paragraph cleanup summary to the user.
