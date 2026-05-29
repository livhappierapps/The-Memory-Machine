import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { threadsTable, messagesTable } from "@workspace/db";
import { eq, and, count, min, max, sql, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Get vault stats for the authenticated user
router.get("/stats", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    const [threadStats] = await db
      .select({
        total: count(),
        archived: sql<number>`sum(case when ${threadsTable.archived} then 1 else 0 end)`,
        oldest: min(threadsTable.createdAt),
        newest: max(threadsTable.createdAt),
      })
      .from(threadsTable)
      .where(and(eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt)));

    const total = Number(threadStats?.total ?? 0);
    const archived = Number(threadStats?.archived ?? 0);

    const [msgStats] = await db
      .select({
        total: count(),
        user: sql<number>`sum(case when ${messagesTable.role} = 'user' then 1 else 0 end)`,
        assistant: sql<number>`sum(case when ${messagesTable.role} = 'assistant' then 1 else 0 end)`,
      })
      .from(messagesTable)
      .innerJoin(threadsTable, eq(messagesTable.threadId, threadsTable.id))
      .where(and(eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt)));

    res.json({
      totalThreads: total,
      activeThreads: total - archived,
      archivedThreads: archived,
      totalMessages: Number(msgStats?.total ?? 0),
      userMessages: Number(msgStats?.user ?? 0),
      assistantMessages: Number(msgStats?.assistant ?? 0),
      oldestThreadAt: threadStats?.oldest ? threadStats.oldest.toISOString() : null,
      newestThreadAt: threadStats?.newest ? threadStats.newest.toISOString() : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
