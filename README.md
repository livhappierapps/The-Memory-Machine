# The Memory Machine

A conversation-memory vault for importing, organizing and retrieving AI chat history. Includes a web app, an Expo mobile app, and an authenticated MCP/API backend.

## Development

This is a pnpm TypeScript workspace. See [project instructions](replit.md) for source layout, required environment-variable names and commands.

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/api-server test
```

Configure credentials privately. Never commit a populated `.env`, database export, signing material, or user conversation archive.

## Release documentation

- [Release readiness and confirmed blockers](docs/RELEASE-READINESS.md)
- [Connecting other AI applications](docs/CONNECTING-AI-APPS.md)
- [Security review](docs/SECURITY-REVIEW.md)

This repository is **not a declaration of App Store or Google Play approval**. Mobile binaries require a live API and authentication service. See the readiness document before starting cloud builds.
