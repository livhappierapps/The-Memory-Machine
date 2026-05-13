import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { randomUUID } from "crypto";

const router: IRouter = Router();

async function getOrCreateSettings(userId: string) {
  let [settings] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.userId, userId));

  if (!settings) {
    [settings] = await db
      .insert(settingsTable)
      .values({ userId, defaultModel: "grok-3", maxContextMessages: 100 })
      .returning();
  }

  return settings;
}

function formatSettings(settings: typeof settingsTable.$inferSelect) {
  return {
    userId: settings.userId,
    hasApiKey: !!settings.apiKey,
    defaultModel: settings.defaultModel,
    maxContextMessages: settings.maxContextMessages,
    mcpToken: settings.mcpToken ?? null,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

router.get("/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const settings = await getOrCreateSettings(req.userId!);
    res.json(formatSettings(settings));
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

    const updateData: Record<string, unknown> = {};
    if (parsed.data.apiKey !== undefined) {
      updateData.apiKey = parsed.data.apiKey || null;
    }
    if (parsed.data.defaultModel !== undefined) {
      updateData.defaultModel = parsed.data.defaultModel;
    }
    if (parsed.data.maxContextMessages !== undefined) {
      updateData.maxContextMessages = parsed.data.maxContextMessages;
    }

    const [settings] = await db
      .insert(settingsTable)
      .values({
        userId,
        apiKey: (updateData.apiKey as string | null) ?? null,
        defaultModel: (updateData.defaultModel as string) ?? "grok-3",
        maxContextMessages: (updateData.maxContextMessages as number) ?? 100,
      })
      .onConflictDoUpdate({
        target: settingsTable.userId,
        set: updateData,
      })
      .returning();

    res.json(formatSettings(settings));
  } catch (err) {
    req.log.error({ err }, "Failed to update settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/mcp-token", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const newToken = randomUUID();

    const [settings] = await db
      .insert(settingsTable)
      .values({ userId, defaultModel: "grok-3", maxContextMessages: 100, mcpToken: newToken })
      .onConflictDoUpdate({
        target: settingsTable.userId,
        set: { mcpToken: newToken },
      })
      .returning();

    res.json(formatSettings(settings));
  } catch (err) {
    req.log.error({ err }, "Failed to generate MCP token");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
