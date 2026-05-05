import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { threadsTable, messagesTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import {
  CreateThreadBody,
  UpdateThreadBody,
  ListThreadsQueryParams,
  GetThreadParams,
  UpdateThreadParams,
  DeleteThreadParams,
  ExportThreadParams,
  ExportThreadQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// List threads
router.get("/threads", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    // zod.coerce.boolean() converts the string "false" to true — handle manually
    const rawQuery = { ...req.query };
    if (rawQuery.archived === "false") (rawQuery as any).archived = false;
    else if (rawQuery.archived === "true") (rawQuery as any).archived = true;

    const parsed = ListThreadsQueryParams.safeParse(rawQuery);
    const query = parsed.success ? parsed.data : {};

    const conditions = [eq(threadsTable.userId, userId)];

    if (query.archived !== undefined) {
      conditions.push(eq(threadsTable.archived, query.archived));
    }

    let rows = await db
      .select()
      .from(threadsTable)
      .where(and(...conditions))
      .orderBy(desc(threadsTable.pinned), desc(threadsTable.lastMessageAt), desc(threadsTable.createdAt));

    if (query.search) {
      const s = query.search.toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(s));
    }

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list threads");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create thread
router.post("/threads", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const parsed = CreateThreadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      return;
    }

    const [thread] = await db
      .insert(threadsTable)
      .values({
        userId,
        title: parsed.data.title,
        model: parsed.data.model ?? "grok-3",
      })
      .returning();

    res.status(201).json(thread);
  } catch (err) {
    req.log.error({ err }, "Failed to create thread");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get thread
router.get("/threads/:threadId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = GetThreadParams.safeParse({ threadId: req.params.threadId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }

    const [thread] = await db
      .select()
      .from(threadsTable)
      .where(and(eq(threadsTable.id, params.data.threadId), eq(threadsTable.userId, userId)));

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    res.json(thread);
  } catch (err) {
    req.log.error({ err }, "Failed to get thread");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update thread
router.patch("/threads/:threadId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = UpdateThreadParams.safeParse({ threadId: req.params.threadId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }
    const parsed = UpdateThreadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      return;
    }

    const [thread] = await db
      .update(threadsTable)
      .set(parsed.data)
      .where(and(eq(threadsTable.id, params.data.threadId), eq(threadsTable.userId, userId)))
      .returning();

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    res.json(thread);
  } catch (err) {
    req.log.error({ err }, "Failed to update thread");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete thread
router.delete("/threads/:threadId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = DeleteThreadParams.safeParse({ threadId: req.params.threadId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }

    const [thread] = await db
      .delete(threadsTable)
      .where(and(eq(threadsTable.id, params.data.threadId), eq(threadsTable.userId, userId)))
      .returning();

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete thread");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Export thread
router.get("/threads/:threadId/export", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const params = ExportThreadParams.safeParse({ threadId: req.params.threadId });
    if (!params.success) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }
    const queryParsed = ExportThreadQueryParams.safeParse(req.query);
    const format = queryParsed.success ? (queryParsed.data.format ?? "json") : "json";

    const [thread] = await db
      .select()
      .from(threadsTable)
      .where(and(eq(threadsTable.id, params.data.threadId), eq(threadsTable.userId, userId)));

    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.threadId, params.data.threadId))
      .orderBy(messagesTable.createdAt);

    let content: string;
    if (format === "markdown") {
      const lines = [`# ${thread.title}`, "", `*Exported on ${new Date().toISOString()}*`, ""];
      for (const msg of messages) {
        lines.push(`## ${msg.role === "user" ? "You" : "Grok"}`, "");
        lines.push(msg.content, "");
      }
      content = lines.join("\n");
    } else {
      content = JSON.stringify({ thread, messages }, null, 2);
    }

    res.json({
      threadId: thread.id,
      title: thread.title,
      format,
      content,
      exportedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to export thread");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
