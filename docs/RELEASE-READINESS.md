# Release readiness — 2026-11-09

## Current stage: PREPARING

This work has **not** produced a signed IPA/APK, uploaded a new TestFlight build, submitted a store release or obtained approval. No paid cloud build or signing-certificate change was started.

## Completed in this pass

- Private companion source, artwork, tests, old build configuration and private notes packaged into a verified standalone ZIP, outside deployments and future checkpoints.
- Private mobile artifact removed from active source; its workflow was removed automatically.
- Private companion download section removed from public settings.
- Historical harvest/debug documents moved into the handoff ZIP, including a 24 MB generated file-tree dump.
- Public project instructions replaced with concise current scope, commands and safety constraints.
- Compatible dependency security updates and Zod/form-validation migration.
- Mobile HTTPS origin normalization fixed across generated API calls, chat streaming and imports.
- Metro isolated from unrelated transient build output, fixing a reproduced ENOENT watcher crash during API rebuild.
- External Android CI definition reduced to the public app only. Its test APK configuration embeds JavaScript instead of relying on a Metro-dependent debug build. This CI workflow has not been executed.
- Cross-app connection research documented without weakening OAuth restrictions or claiming universal compatibility.

## Evidence

- Full workspace type check: passed.
- API tests: **198 passed** after dependency/validation updates.
- Storage-transfer and security regression scripts: **21 passed**.
- Mobile origin tests: **2 passed**.
- Mobile build-helper and watcher tests: **5 passed**.
- Expo dependency compatibility check: passed.
- Expo Doctor: **18/18 passed** before the Zod-only dependency change; native packages were not changed by that migration.
- Local iOS, Android and web JavaScript/Hermes exports: passed. These are **not native binaries** and do not prove device sign-in or launch.
- Public web and mobile browser startup screenshots: rendered successfully. Browser startup is not physical iPhone/Samsung testing.
- Public API health: HTTP 200.
- OAuth discovery documents: HTTP 200.
- MCP without authorization: HTTP 401, as required.

Tests use temporary fixtures in the development database; they do not certify the user's production memories or large original archive as imported.

## First confirmed blocker: backend independence

Publishing metadata identifies the running backend as a Replit autoscale deployment at `https://the-memory-machine.replit.app`. Mobile preview/production profiles and MCP's canonical OAuth origin still reference that service.

An APK/IPA can install independently of the development editor while still depending on this backend. That does **not** meet the requirement to keep functioning if the Replit-hosted backend becomes unavailable.

No independently hosted public API was verified in this pass. Do not spend a store build to freeze the wrong backend URL into the app.

The release needs a verified external API, durable database/storage and encryption-key continuity, plus correct authentication/OAuth origins. A new domain or a static frontend alone does not move the API. Free hosting may sleep, impose quotas, change terms or discontinue service; do not promise permanent free availability.

## Other observed boundaries

- The user has finalized pricing at **$4.99/month** or **$39.99/year**. These amounts are a product decision; billing/store price configuration is not verified here.
- The existing mobile preview configuration uses a Clerk development key. The production profile does not itself specify a publishable key; external build-environment configuration has not been verified. Preview screenshots also report development Clerk configuration.
- The existing iOS/Android bundle IDs and Expo project were preserved. Current Apple signing, uploaded builds and App Store Connect status were not re-queried here.
- No physical iPhone/Samsung cold launch, sign-in, import, retrieval or reconnection was performed. Those remain necessary before calling the app ship-ready.
- Remaining scanner findings are listed in the security report, not silently ignored.
- Current OAuth is Grok-specific. MiddleMain's real end-to-end connection is not certified by generic unit tests.
- Large ZIP import still assembles uploads on temporary server disk and reads ZIP bytes into process memory. This is not a verified large-archive, background-safe ingestion system across autoscaling restarts.

## Cleanup measurements

| Item | Before | After |
| --- | --- | --- |
| Active private mobile artifact | Present | Removed |
| Private mobile workflow | Running | Removed |
| Documentation directory | About 24 MB | Small current documents |
| Saved history | About 128 MB | Not rewritten or erased |

Original user attachments and prior export ZIPs were preserved and excluded from deployment. Historical versions can still contain removed source. Do not publish this entire repository history as “sanitized” without a separate review.

## Next release gate

Verify independent backend/storage/authentication first. Then reuse signing and existing builds where possible, obtain approval before any potentially billable build, test actual signed binaries on both devices, and only then proceed to TestFlight/store submission.
