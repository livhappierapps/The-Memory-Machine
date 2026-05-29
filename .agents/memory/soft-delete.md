---
name: Soft delete pattern
description: How threads soft-delete works — deletedAt column, 30-day lock, restore, purge cron
---

## Rule
All thread list/get/update queries must include `isNull(threadsTable.deletedAt)` in their WHERE clause. Soft-deleted threads are excluded from all normal queries.

## 30-day recency lock
Threads created within the last 30 days return HTTP 423 on DELETE with `{ error: "recency_lock", unlocksAt }`.

## Restore window
Soft-deleted threads can be restored within 30 days via `PATCH /api/threads/:id/restore`. After 30 days, the purge cron permanently deletes them.

## Purge cron
`purgeExpiredSoftDeletes()` in `routes/deletion-requests.ts` — called at startup and every 6h via setInterval in `app.ts`.

**Why:** Users needed a safety net after accidental deletes; the 30-day window mirrors industry standard trash behavior.
