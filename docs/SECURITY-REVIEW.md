# Security review — 2026-11-09

## Status

**Not a clean security bill of health or a penetration test.** All three requested scanners completed. Findings were reviewed rather than hidden or dismissed automatically.

| Scan | Initial | After dependency remediation |
| --- | --- | --- |
| Dependencies | 0 critical, 26 high, 24 moderate, 14 low | 0 critical, 10 high, 10 moderate, 8 low |
| Static analysis | 10 high, 5 medium | Locations reviewed; scanner alerts remain unless rescanned/classified |
| Privacy/dataflow | 1 low | Offending test email/user-ID log removed; no second scan claimed |

Counts include development tooling and example manifests under `.agents/skills`, not just the shipped app. Duplicate advisory databases can report the same issue twice.

## Remediated dependencies

Compatible patched versions now resolve for body-parser, multer, undici, Vite, fast-uri, follow-redirects, node-forge, decode-uri-component and Vitest's mocker.

Application validation moved to patched Zod 4 with a compatible form resolver. An unused mobile Zod-error dependency was removed. The complete type check and all 198 API tests passed after this migration.

## Remaining findings

### High

- **image-size 1.2.1:** two malformed-image infinite-loop advisories remain in Metro's build dependency. Metro expects the v1 callable/path API; globally forcing v2 previously broke mobile builds. Do not substitute a security override that prevents the app from building. Treat build inputs as trusted and resolve with an API-compatible upstream patch or a separately tested Metro adapter before declaring this closed. No public API image-size call was found during this review.
- **python-multipart example requirements:** eight high scanner entries, including duplicate advisories, arise from the optional MCP-builder skill tooling. This is not the application's Express upload handler and is excluded from deployment with `.agents`. Its tooling dependencies still require maintenance; exclusion is not a vulnerability fix.

### Moderate / low

- `@hono/node-server` static-serving advisory, transitively present through the MCP SDK. The public service uses Express, not Hono's `serveStatic`; the affected path was not found in application code.
- `deepmerge` has no advertised patched version in the scan result.
- `glob` and `minimatch` need compatibility-reviewed major upgrades, not blanket overrides of native tooling.
- Optional skill manifests still contain fast-uri/python-multipart findings.

These remain visible and are not described as fixed.

## Static-analysis triage

- Import routes validate UUID upload IDs and integer chunk metadata, hash the authenticated user ID into a private directory, and restrict imported files using canonical realpath containment and regular-file checks. Existing path-validation and chunked-import tests pass. The scanner does not infer all these safeguards.
- Mobile static serving validates platform values, rejects nulls/backslashes, and checks canonical containment including symlinks. Paths are not arbitrary filesystem reads merely because they reach `fs`.
- OAuth's API redirect goes to a fixed relative consent page. Consent callbacks are separately checked against trusted HTTPS domains, with no userinfo or fragments. Do not remove those checks to support additional AI apps.
- The trusted-device cookie is issued only after challenge/token verification, not directly from an unverified query parameter. Broader device-security review remains outside what a pattern scanner proves.
- The skill preview server's SHA-1 is a development-tool finding, separate from production field encryption.

No blanket false-positive dismissal has been applied. This review does not replace adversarial testing.

## Additional release risks

OAuth currently uses the user's shared MCP token rather than independently revocable per-client tokens, and advertises combined read/write scopes. See the connection report. Broader public connector support must preserve strict ownership and consent.

Original uploads, handoff archives, historical exports and research are excluded from deployment. They may still exist in local files and saved history. Before open-sourcing, audit the full repository and history separately for private data and licensing; `.gitignore` does not sanitize history.
