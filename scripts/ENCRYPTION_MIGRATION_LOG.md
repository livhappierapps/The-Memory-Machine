# Encryption Migration Log

## Run: 2026-05-31

**Script:** `pnpm --filter @workspace/scripts run encrypt-migration`  
**Environment:** Replit managed PostgreSQL (DATABASE_URL — single database shared by dev and prod; no separate production Neon database exists yet)  
**Encryption scheme:** AES-256-GCM field-level, HKDF per-user key derivation, prefix `enc:v1:`

### Results

| Table | Rows migrated | Already encrypted | Failed |
|---|---|---|---|
| messages (content) | 21,000 | 0 | 0 |
| profiles (apiKey, openAiApiKey, anthropicApiKey, googleApiKey) | 0 | 8 | 0 |
| settings (mcpToken + mcpTokenHash) | 5 | 4 | 0 |

### Verification SQL

```sql
-- All three queries returned 0 (no plaintext rows remain)
SELECT count(*) FROM messages WHERE content NOT LIKE 'enc:v1:%';         -- 0
SELECT count(*) FROM profiles
  WHERE api_key IS NOT NULL AND api_key NOT LIKE 'enc:v1:%';             -- 0
SELECT count(*) FROM settings
  WHERE mcp_token IS NOT NULL AND mcp_token NOT LIKE 'enc:v1:%';         -- 0

-- Idempotency confirmed: second run shows 0 encrypted, 21,000 already done
```

### Idempotency check

Re-running the script immediately after produced:

- messages: 0 encrypted, 21,000 already done, 0 failed  
- profiles: 0 profiles encrypted, 8 already done  
- settings: 0 rows migrated, 9 already done  

The script is safe to re-run at any time.
