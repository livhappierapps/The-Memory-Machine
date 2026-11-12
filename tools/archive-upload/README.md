# Private original-archive transfer

This narrow utility uploads intact ZIP archives to the owner's private Cloudflare
R2 bucket. It does **not** parse an export, import memories into an account, replace
the application backend, or establish a different model connection.

The Cloudflare dashboard rejects uploads above 300 MB. This page instead sends
8 MiB multipart requests, supporting ZIPs up to 3 GiB without reading the whole ZIP
into browser memory. Keep the source ZIP after uploading.

## Hosting and authentication

- Worker name: `memory-machine-archive-upload`
- Account Workers subdomain: `memory-machine-ef2e5606`
- R2 bucket: `memory-machine-original-exports`, Standard storage, not public
- Cloudflare Access protects the **Worker destination**, including every route.
- The Access policy admits only the connected account owner's email.
- The Worker independently checks `ctx.access`, the exact application audience,
  and the authenticated email. A supplied HTTP identity header is not trusted.
- No API keys are embedded in the page. Cloudflare account sign-in is the only
  identity provider configured for this application.
- Browser code cannot delete or download saved archives through this utility.

Bindings are `ARCHIVES` (R2), `OWNER_EMAIL` (owner identity), and `ACCESS_AUD`
(application audience, not a secret). Query the existing Cloudflare configuration
when updating; do not replace the policy or change the owner inadvertently.

Deploy through the connected Cloudflare API as a module Worker: replace
`export default createArchiveWorker("");` in `worker.mjs` with a call containing
the JSON-encoded `upload.html` text. Upload that module with the existing bindings,
compatibility date `2026-10-30`, and observability disabled. Keep preview URLs
disabled. Never expose the bucket through r2.dev or a custom public domain.

The default incomplete-multipart cleanup runs after seven days. Completed archive
objects have no expiration rule. That is not a promise of perpetual service:
Cloudflare account access, storage terms, billing, and a separate recoverable
backup still matter.

## Recovery and verification

The page remembers file identity and its upload session. Reselecting the same ZIP
loads server-confirmed receipts, skipping already stored parts. Failed network
requests are retried a bounded number of times. There is no automatic background
upload guarantee on iOS: keep Safari open and the phone unlocked.

Receipts live in each part object's small custom metadata so listing a large
upload does not require hundreds of Worker subrequests. The server checks all part
numbers and sizes before completing. Success requires the resulting object's
size to match the selected file, not just a successful final HTTP response.
This is size verification, not a whole-archive cryptographic checksum.

Run the isolated backend tests (no Cloudflare, database, or billing):

```sh
node --test tools/archive-upload/worker.test.mjs
```

`worker.test.mjs` mocks R2 and validated Cloudflare Access context. It cannot prove
real Cloudflare sign-in or a full 2 GB upload from an iPhone. Live unauthenticated
GET and POST requests should redirect to Cloudflare Access, never reach storage.
