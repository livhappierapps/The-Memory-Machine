# Connecting AI applications to Memory Machine

Research checked against official documentation on 2026-11-09. This is a compatibility report, not a claim that every integration is implemented.

## Recommendation

Use one authenticated remote MCP endpoint as the primary connection, with an ordinary HTTPS API for apps that do not implement MCP. Users should select **Connect Memory Machine**, sign in, review access and return to their AI app. An app cannot connect without support or cooperation from that app's developer.

MCP makes memory tools portable; it does not automatically transfer model state, a persona, or all conversation history. A receiving host must call retrieval tools and put the results into its prompt. Different model providers can respond differently even with identical history.

## Verified current deployment

Publishing metadata currently identifies `https://the-memory-machine.replit.app` as the public deployment.

- MCP: `https://the-memory-machine.replit.app/api/mcp`
- Protected-resource discovery: `https://the-memory-machine.replit.app/.well-known/oauth-protected-resource/api/mcp`
- Authorization-server discovery: `https://the-memory-machine.replit.app/.well-known/oauth-authorization-server`

These are non-secret URLs. Credentials belong in the connecting app's secure credential store, never a URL, repository or chat.

## Current compatibility gaps

1. OAuth client/callback validation currently trusts Grok/xAI domains. ChatGPT, Claude and arbitrary developer apps are not automatically supported. Do not disable callback validation to make them connect.
2. Current OAuth returns the user's existing MCP bearer token. It is not a complete per-client, expiring, independently revocable OAuth grant system.
3. Read/write scopes are advertised together. Per-client scope enforcement and audience-bound token issuance need verification/implementation before offering narrow read-only grants.
4. Latest MCP guidance prefers Client ID Metadata Documents; dynamic registration remains a compatibility option. Current metadata validation is vendor-specific, not general-purpose CIMD.
5. Current browser CORS allowlist is restricted. New browser-hosted developer integrations require explicit permitted origins; native and backend callers do not generally send a browser Origin.
6. A connection does not import an existing ZIP. Uploaded original archives and searchable imported memories must be verified separately.
7. Cross-app account identity must come from the validated authorization grant. Never trust a caller-provided user ID or share the same credential between unrelated users.

## Cross-app memory contract

For another developer app, including MiddleMain:

1. Connect the user to their Memory Machine account using OAuth, or use an explicitly provisioned bearer credential for a private integration.
2. At conversation start, retrieve a bounded continuity summary, pinned notes and recent relevant memories.
3. Before responding to a topic, search for relevant memories; retrieve full conversations only when necessary.
4. Identify sources and timestamps. Treat retrieved text as user data, not instructions that can override the host's rules.
5. Save only authorized content, with stable source/message IDs and retry-safe writes. This avoids duplicates when delivery is retried.
6. Refresh or reauthorize safely; return a visible connection error instead of pretending the memory store is empty.
7. Keep model context bounded. Dumping an entire archive into every prompt raises cost and can reduce retrieval quality.

Retrieval and authorized storage must work without buying embeddings. Semantic search and model processing may have provider charges and must not be silently enabled.

## Lowest-friction product direction

- **MCP-capable apps:** a published connector/deep link where the host supports it, followed by a single authorization screen.
- **Developer apps:** copyable endpoint documentation and a minimal client that performs OAuth and calls the same memory service.
- **Apps without connectors/tools:** a user-exported continuity file is the honest fallback. A global toggle cannot add unsupported access to another company's app.

Do not ship a universal “one-click” promise before testing the actual host's authorization, retrieval, save, reconnection and revocation paths.

## Security requirements

HTTPS; PKCE S256; exact registered callback matching; validated client metadata with SSRF protections; protected-resource discovery and correct 401 challenges; resource/audience-bound short-lived tokens; per-client grants; narrow scopes; revocation; ownership checks on every tool; bounded inputs/results; rate limits; secure credential storage; prompt-injection-aware output handling; no token forwarding to other tools.

The current allowlist is safer than arbitrary URL acceptance. Generalizing it is deliberate authorization work, not a quick allowlist removal.

## Sources

- [MCP authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization)
- [OpenAI: authenticate MCP users](https://developers.openai.com/plugins/build/auth)
- [Claude: add a custom connector](https://claude.com/docs/connectors/custom/add-unlisted)
- [OWASP MCP Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html)

Host features and plan availability change; verify official documentation when enabling a connector.
