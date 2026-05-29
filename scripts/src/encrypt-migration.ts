#!/usr/bin/env tsx
// @ts-nocheck
/**
 * encrypt-migration.ts
 *
 * One-shot migration: encrypts all plaintext message content and profile API keys
 * that are not yet prefixed with "enc:v1:". Safe to re-run — already-encrypted
 * rows are detected by the prefix and skipped.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run encrypt-migration
 *
 * Requires: DATABASE_URL, ENCRYPTION_ROOT_SECRET environment variables.
 */

import { db } from "@workspace/db";
import { messagesTable, profilesTable, settingsTable } from "@workspace/db";
import { eq, isNull, and, ne } from "drizzle-orm";
import { encryptField, decryptField, sha256Hex } from "../../artifacts/api-server/src/lib/field-crypto";

const ENC_PREFIX = "enc:v1:";
const BATCH = 200;

function isEncrypted(s: string | null | undefined): boolean {
  return !!s && s.startsWith(ENC_PREFIX);
}

// ── Messages ──────────────────────────────────────────────────────────────────

async function migrateMessages(): Promise<void> {
  console.log("\n── Messages ─────────────────────────────────────────────");

  // Group messages by userId via their thread
  const { threadsTable } = await import("@workspace/db");

  const rows = await db
    .select({
      id: messagesTable.id,
      content: messagesTable.content,
      threadId: messagesTable.threadId,
    })
    .from(messagesTable);

  // Build threadId → userId map via threads table
  const { desc } = await import("drizzle-orm");
  const threads = await db.select({ id: threadsTable.id, userId: threadsTable.userId }).from(threadsTable);
  const threadUserMap = new Map(threads.map((t) => [t.id, t.userId]));

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    for (const row of batch) {
      const userId = threadUserMap.get(row.threadId);
      if (!userId) {
        console.warn(`  WARN: message ${row.id} has no matching thread userId — skipping`);
        skipped++;
        continue;
      }
      if (isEncrypted(row.content)) {
        skipped++;
        continue;
      }
      try {
        await db
          .update(messagesTable)
          .set({ content: encryptField(userId, row.content) })
          .where(eq(messagesTable.id, row.id));
        migrated++;
      } catch (err) {
        console.error(`  ERROR message ${row.id}:`, err);
        failed++;
      }
    }
    if (i % 1000 === 0 && i > 0) {
      console.log(`  Progress: ${i}/${rows.length} rows processed`);
    }
  }

  console.log(`  Done: ${migrated} encrypted, ${skipped} already done, ${failed} failed`);
}

// ── Profiles ──────────────────────────────────────────────────────────────────

async function migrateProfiles(): Promise<void> {
  console.log("\n── Profile API keys ─────────────────────────────────────");

  const profiles = await db.select().from(profilesTable);
  let migrated = 0;
  let skipped = 0;

  for (const profile of profiles) {
    const update: Record<string, string | null> = {};
    const fields: Array<keyof typeof profile> = ["apiKey", "openAiApiKey", "anthropicApiKey", "googleApiKey"];

    for (const field of fields) {
      const val = profile[field] as string | null;
      if (val && !isEncrypted(val)) {
        update[field] = encryptField(profile.userId, val);
      }
    }

    if (Object.keys(update).length === 0) {
      skipped++;
      continue;
    }

    await db.update(profilesTable).set(update as any).where(eq(profilesTable.id, profile.id));
    migrated++;
  }

  console.log(`  Done: ${migrated} profiles encrypted, ${skipped} already done`);
}

// ── Settings mcpToken ─────────────────────────────────────────────────────────

async function migrateSettings(): Promise<void> {
  console.log("\n── Settings MCP tokens ──────────────────────────────────");

  const rows = await db.select().from(settingsTable);
  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    const token = row.mcpToken;
    if (!token) {
      skipped++;
      continue;
    }
    // If already encrypted and hash is set, skip
    if (isEncrypted(token) && row.mcpTokenHash) {
      skipped++;
      continue;
    }
    // If plaintext token exists (not encrypted) — encrypt it and compute hash
    const plainToken = isEncrypted(token) ? decryptField(row.userId, token) : token;
    const hash = sha256Hex(plainToken);
    const encrypted = encryptField(row.userId, plainToken);

    await db
      .update(settingsTable)
      .set({ mcpToken: encrypted, mcpTokenHash: hash })
      .where(eq(settingsTable.userId, row.userId));

    migrated++;
  }

  console.log(`  Done: ${migrated} settings rows migrated, ${skipped} already done`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.ENCRYPTION_ROOT_SECRET) {
    console.error("ENCRYPTION_ROOT_SECRET is not set. Aborting.");
    process.exit(1);
  }

  console.log("Starting encryption migration…");
  console.log("ENCRYPTION_ROOT_SECRET is set ✓");
  console.log("DATABASE_URL:", process.env.DATABASE_URL ? "set ✓" : "MISSING ✗");

  try {
    await migrateMessages();
    await migrateProfiles();
    await migrateSettings();
    console.log("\n✓ Migration complete.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

main();
