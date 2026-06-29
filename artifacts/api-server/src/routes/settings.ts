import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { settingsTable, profilesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { randomUUID } from "crypto";
import { encryptField, decryptField, sha256Hex } from "../lib/field-crypto";

const router: IRouter = Router();

/**
 * Decrypt the mcpToken stored in settings for display to the owner.
 * Returns null if no token exists.
 * Migration-safe: decryptField returns plaintext as-is if not encrypted.
 */
function getDisplayToken(userId: string, encrypted: string | null): string | null {
  if (!encrypted) return null;
  return decryptField(userId, encrypted);
}

async function getOrCreateSettings(userId: string) {
  let [settings] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.userId, userId));

  if (!settings) {
    const newToken = randomUUID();
    const hash = sha256Hex(newToken);
    const encrypted = encryptField(userId, newToken);
    [settings] = await db
      .insert(settingsTable)
      .values({
        userId,
        defaultModel: "grok-3",
        maxContextMessages: 100,
        mcpToken: encrypted,
        mcpTokenHash: hash,
      })
      .returning();
  } else if (!settings.mcpToken) {
    const newToken = randomUUID();
    const hash = sha256Hex(newToken);
    const encrypted = encryptField(userId, newToken);
    [settings] = await db
      .update(settingsTable)
      .set({ mcpToken: encrypted, mcpTokenHash: hash })
      .where(eq(settingsTable.userId, userId))
      .returning();
  } else if (!settings.mcpTokenHash) {
    // Migration: existing plaintext token — compute hash and encrypt
    const plainToken = settings.mcpToken; // currently plaintext
    const hash = sha256Hex(plainToken);
    const encrypted = encryptField(userId, plainToken);
    [settings] = await db
      .update(settingsTable)
      .set({ mcpToken: encrypted, mcpTokenHash: hash })
      .where(eq(settingsTable.userId, userId))
      .returning();
  }

  return settings;
}

// Return the user's first (default) profile, if any
async function getDefaultProfile(userId: string) {
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId))
    .orderBy(asc(profilesTable.createdAt))
    .limit(1);
  return profile ?? null;
}

function formatSettings(
  userId: string,
  settings: typeof settingsTable.$inferSelect,
  profile: typeof profilesTable.$inferSelect | null,
) {
  return {
    userId: settings.userId,
    // Prefer per-profile values; fall back to global settingsTable row
    hasApiKey: profile ? !!profile.apiKey : !!settings.apiKey,
    defaultModel: profile?.defaultModel ?? settings.defaultModel,
    maxContextMessages: profile?.maxContextMessages ?? settings.maxContextMessages,
    // Decrypt mcpToken for display — user sees their plain UUID, not the enc:v1: blob
    mcpToken: getDisplayToken(userId, settings.mcpToken ?? null),
    paymentStatus: settings.paymentStatus ?? "active",
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

router.get("/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const [settings, profile] = await Promise.all([
      getOrCreateSettings(userId),
      getDefaultProfile(userId),
    ]);
    res.json(formatSettings(userId, settings, profile));
  } catch (err) {
    req.log.error({ err }, "Failed to get settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const parsed = UpdateSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      return;
    }

    const globalUpdate: Record<string, unknown> = {};
    const profileUpdate: Record<string, unknown> = {};

    if (parsed.data.apiKey !== undefined) {
      const apiKeyVal = parsed.data.apiKey || null;
      const encryptedApiKey = apiKeyVal ? encryptField(userId, apiKeyVal) : null;
      globalUpdate.apiKey = encryptedApiKey;
      profileUpdate.apiKey = encryptedApiKey;
    }
    if (parsed.data.defaultModel !== undefined) {
      globalUpdate.defaultModel = parsed.data.defaultModel;
      profileUpdate.defaultModel = parsed.data.defaultModel;
    }
    if (parsed.data.maxContextMessages !== undefined) {
      globalUpdate.maxContextMessages = parsed.data.maxContextMessages;
      profileUpdate.maxContextMessages = parsed.data.maxContextMessages;
    }

    // Write to global settings (primary for mcpToken fallback)
    const [settings] = await db
      .insert(settingsTable)
      .values({
        userId,
        apiKey: (globalUpdate.apiKey as string | null) ?? null,
        defaultModel: (globalUpdate.defaultModel as string) ?? "grok-3",
        maxContextMessages: (globalUpdate.maxContextMessages as number) ?? 100,
      })
      .onConflictDoUpdate({
        target: settingsTable.userId,
        set: globalUpdate,
      })
      .returning();

    // Also sync to the user's default profile so settings are profile-aware
    const profile = await getDefaultProfile(userId);
    if (profile && Object.keys(profileUpdate).length > 0) {
      await db
        .update(profilesTable)
        .set(profileUpdate)
        .where(eq(profilesTable.id, profile.id));
    }

    const updatedProfile = profile
      ? { ...profile, ...profileUpdate } as typeof profilesTable.$inferSelect
      : null;

    // Ensure mcpToken is provisioned
    const finalSettings = await getOrCreateSettings(userId);

    res.json(formatSettings(userId, { ...finalSettings, ...settings }, updatedProfile));
  } catch (err) {
    req.log.error({ err }, "Failed to update settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/mcp-token", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const newToken = randomUUID();
    const hash = sha256Hex(newToken);
    const encrypted = encryptField(userId, newToken);

    const [settings] = await db
      .insert(settingsTable)
      .values({
        userId,
        defaultModel: "grok-3",
        maxContextMessages: 100,
        mcpToken: encrypted,
        mcpTokenHash: hash,
      })
      .onConflictDoUpdate({
        target: settingsTable.userId,
        set: { mcpToken: encrypted, mcpTokenHash: hash },
      })
      .returning();

    const profile = await getDefaultProfile(userId);
    res.json(formatSettings(userId, settings, profile));
  } catch (err) {
    req.log.error({ err }, "Failed to generate MCP token");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
