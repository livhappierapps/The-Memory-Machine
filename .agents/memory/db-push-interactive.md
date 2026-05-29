---
name: DB push interactive prompts
description: drizzle-kit push blocks on interactive prompts that cannot be skipped with CLI flags
---

## Rule
`pnpm --filter @workspace/db run push` (which runs `drizzle-kit push`) prompts interactively for new tables asking "created or renamed from another table?" and for destructive operations. There is no `--yes` or `--force` flag that skips these prompts.

## Workaround
For automation, use psql directly:
```bash
psql "$DATABASE_URL" << 'SQL'
CREATE TABLE IF NOT EXISTS ...;
ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...;
SQL
```

**Why:** drizzle-kit v0.31+ removed non-interactive flags for safety; discovered when creating deletion_requests and user_keyphrases tables.

**How to apply:** Whenever schema migrations are needed in a non-interactive context (CI, agent scripts), use the psql workaround instead of drizzle-kit push.
