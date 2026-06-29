import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { profilesTable, settingsTable, threadsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateProfileBody,
  UpdateProfileBody,
  GetProfileParams,
  UpdateProfileParams,
  DeleteProfileParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { encryptField, isEncrypted } from "../lib/field-crypto";

const router: IRouter = Router();

function formatProfile(profile: typeof profilesTable.$inferSelect) {
  return {
    id: profile.id,
    userId: profile.userId,
    name: profile.name,
    emoji: profile.emoji,
    color: profile.color,
    personalityNotes: profile.personalityNotes ?? null,
    chatProvider: profile.chatProvider ?? "xai",
    hasApiKey: !!profile.apiKey,
    hasAnthropicApiKey: !!profile.anthropicApiKey,
    hasGoogleApiKey: !!profile.googleApiKey,
    defaultModel: profile.defaultModel,
    maxContextMessages: profile.maxContextMessages,
    // Memory engine settings
    embeddingProvider: profile.embeddingProvider ?? "xai",
    hasOpenAiApiKey: !!profile.openAiApiKey,
    smartRetrieval: profile.smartRetrieval,
    topNMemories: profile.topNMemories,
    alwaysIncludeLastN: profile.alwaysIncludeLastN,
    memoryDateFrom: profile.memoryDateFrom ?? null,
    memoryDateTo: profile.memoryDateTo ?? null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

async function ensureDefaultProfile(userId: string) {
  const existing = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (existing.length > 0) return existing;

  const [settings] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.userId, userId));

  // settings.apiKey may be plaintext (legacy) or encrypted — normalise to encrypted
  const rawApiKey = settings?.apiKey ?? null;
  const profileApiKey = rawApiKey
    ? isEncrypted(rawApiKey)
      ? rawApiKey
      : encryptField(userId, rawApiKey)
    : null;

  const [defaultProfile] = await db
    .insert(profilesTable)
    .values({
      userId,
      name: "Default",
      emoji: "🤖",
      color: "#2dd4bf",
      apiKey: profileApiKey,
      defaultModel: settings?.defaultModel ?? "grok-3",
      maxContextMessages: settings?.maxContextMessages ?? 100,
    })
    .returning();

  await db
    .update(threadsTable)
    .set({ profileId: defaultProfile.id })
    .where(eq(threadsTable.userId, userId));

  return [defaultProfile];
}

export { ensureDefaultProfile };

router.get("/profiles", requireAuth, async (req: Request, res: Response) => {
  try {
    const profiles = await ensureDefaultProfile(req.userId!);
    res.json(profiles.map(formatProfile));
  } catch (err) {
    req.log.error({ err }, "Failed to list profiles");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/profiles", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const parsed = CreateProfileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      return;
    }

    const [profile] = await db
      .insert(profilesTable)
      .values({
        userId,
        name: parsed.data.name,
        emoji: parsed.data.emoji ?? "🤖",
        color: parsed.data.color ?? "#2dd4bf",
        personalityNotes: parsed.data.personalityNotes || null,
        chatProvider: parsed.data.chatProvider ?? "xai",
        apiKey: parsed.data.apiKey ? await encryptField(userId, parsed.data.apiKey) : null,
        anthropicApiKey: parsed.data.anthropicApiKey ? await encryptField(userId, parsed.data.anthropicApiKey) : null,
        googleApiKey: parsed.data.googleApiKey ? await encryptField(userId, parsed.data.googleApiKey) : null,
        defaultModel: parsed.data.defaultModel ?? "grok-3",
        maxContextMessages: parsed.data.maxContextMessages ?? 100,
        embeddingProvider: parsed.data.embeddingProvider ?? "xai",
        openAiApiKey: parsed.data.openAiApiKey ? await encryptField(userId, parsed.data.openAiApiKey) : null,
        smartRetrieval: parsed.data.smartRetrieval ?? true,
        topNMemories: parsed.data.topNMemories ?? 10,
        alwaysIncludeLastN: parsed.data.alwaysIncludeLastN ?? 3,
        memoryDateFrom: parsed.data.memoryDateFrom || null,
        memoryDateTo: parsed.data.memoryDateTo || null,
      })
      .returning();

    res.status(201).json(formatProfile(profile));
  } catch (err) {
    req.log.error({ err }, "Failed to create profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/profiles/:profileId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = GetProfileParams.safeParse({ profileId: req.params.profileId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid profile ID" });
      return;
    }

    const [profile] = await db
      .select()
      .from(profilesTable)
      .where(and(eq(profilesTable.id, params.data.profileId), eq(profilesTable.userId, userId)));

    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    res.json(formatProfile(profile));
  } catch (err) {
    req.log.error({ err }, "Failed to get profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/profiles/:profileId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = UpdateProfileParams.safeParse({ profileId: req.params.profileId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid profile ID" });
      return;
    }
    const parsed = UpdateProfileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.emoji !== undefined) updateData.emoji = parsed.data.emoji;
    if (parsed.data.color !== undefined) updateData.color = parsed.data.color;
    if (parsed.data.personalityNotes !== undefined)
      updateData.personalityNotes = parsed.data.personalityNotes || null;
    if (parsed.data.chatProvider !== undefined) updateData.chatProvider = parsed.data.chatProvider;
    if (parsed.data.apiKey !== undefined)
      updateData.apiKey = parsed.data.apiKey ? await encryptField(userId, parsed.data.apiKey) : null;
    if (parsed.data.anthropicApiKey !== undefined)
      updateData.anthropicApiKey = parsed.data.anthropicApiKey ? await encryptField(userId, parsed.data.anthropicApiKey) : null;
    if (parsed.data.googleApiKey !== undefined)
      updateData.googleApiKey = parsed.data.googleApiKey ? await encryptField(userId, parsed.data.googleApiKey) : null;
    if (parsed.data.defaultModel !== undefined) updateData.defaultModel = parsed.data.defaultModel;
    if (parsed.data.maxContextMessages !== undefined)
      updateData.maxContextMessages = parsed.data.maxContextMessages;
    // Memory engine settings
    if (parsed.data.embeddingProvider !== undefined) updateData.embeddingProvider = parsed.data.embeddingProvider;
    if (parsed.data.openAiApiKey !== undefined)
      updateData.openAiApiKey = parsed.data.openAiApiKey ? await encryptField(userId, parsed.data.openAiApiKey) : null;
    if (parsed.data.smartRetrieval !== undefined) updateData.smartRetrieval = parsed.data.smartRetrieval;
    if (parsed.data.topNMemories !== undefined) updateData.topNMemories = parsed.data.topNMemories;
    if (parsed.data.alwaysIncludeLastN !== undefined) updateData.alwaysIncludeLastN = parsed.data.alwaysIncludeLastN;
    if ("memoryDateFrom" in parsed.data) updateData.memoryDateFrom = parsed.data.memoryDateFrom || null;
    if ("memoryDateTo" in parsed.data) updateData.memoryDateTo = parsed.data.memoryDateTo || null;

    const [profile] = await db
      .update(profilesTable)
      .set(updateData)
      .where(and(eq(profilesTable.id, params.data.profileId), eq(profilesTable.userId, userId)))
      .returning();

    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    res.json(formatProfile(profile));
  } catch (err) {
    req.log.error({ err }, "Failed to update profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/profiles/:profileId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = DeleteProfileParams.safeParse({ profileId: req.params.profileId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid profile ID" });
      return;
    }

    const allProfiles = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.userId, userId));

    if (allProfiles.length <= 1) {
      res.status(400).json({ error: "Cannot delete the last profile" });
      return;
    }

    // Pick a sibling profile to receive this profile's threads before deleting
    const fallbackProfile = allProfiles.find((p) => p.id !== params.data.profileId);
    if (!fallbackProfile) {
      res.status(400).json({ error: "Cannot delete the last profile" });
      return;
    }

    // Reassign threads to the fallback profile so they are never orphaned
    await db
      .update(threadsTable)
      .set({ profileId: fallbackProfile.id })
      .where(and(eq(threadsTable.profileId, params.data.profileId), eq(threadsTable.userId, userId)));

    const [profile] = await db
      .delete(profilesTable)
      .where(and(eq(profilesTable.id, params.data.profileId), eq(profilesTable.userId, userId)))
      .returning();

    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
