import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { requireAuth } from "./threads";

const router: IRouter = Router();

// Get settings
router.get("/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    let [settings] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.userId, userId));

    if (!settings) {
      // Auto-create default settings
      [settings] = await db
        .insert(settingsTable)
        .values({ userId, defaultModel: "grok-3", maxContextMessages: 100 })
        .returning();
    }

    res.json({
      userId: settings.userId,
      hasApiKey: !!settings.apiKey,
      defaultModel: settings.defaultModel,
      maxContextMessages: settings.maxContextMessages,
      createdAt: settings.createdAt.toISOString(),
      updatedAt: settings.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update settings
router.put("/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const parsed = UpdateSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      return;
    }

    const updateData: Partial<{
      apiKey: string;
      defaultModel: string;
      maxContextMessages: number;
    }> = {};

    if (parsed.data.apiKey !== undefined) {
      updateData.apiKey = parsed.data.apiKey || null as any;
    }
    if (parsed.data.defaultModel !== undefined) {
      updateData.defaultModel = parsed.data.defaultModel;
    }
    if (parsed.data.maxContextMessages !== undefined) {
      updateData.maxContextMessages = parsed.data.maxContextMessages;
    }

    // Upsert settings
    const [settings] = await db
      .insert(settingsTable)
      .values({
        userId,
        apiKey: updateData.apiKey,
        defaultModel: updateData.defaultModel ?? "grok-3",
        maxContextMessages: updateData.maxContextMessages ?? 100,
      })
      .onConflictDoUpdate({
        target: settingsTable.userId,
        set: updateData,
      })
      .returning();

    res.json({
      userId: settings.userId,
      hasApiKey: !!settings.apiKey,
      defaultModel: settings.defaultModel,
      maxContextMessages: settings.maxContextMessages,
      createdAt: settings.createdAt.toISOString(),
      updatedAt: settings.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
