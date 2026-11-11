import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { threadsTable, messagesTable, profilesTable } from "@workspace/db";
import { eq, and, count, min, max, sql, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Get vault stats for the authenticated user
router.get("/stats", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const profileIdParam = req.query.profileId;
    const profileId = profileIdParam ? parseInt(String(profileIdParam), 10) : undefined;

    // Build the base where condition
    const baseWhere = profileId
      ? and(
          eq(threadsTable.userId, userId),
          isNull(threadsTable.deletedAt),
          eq(threadsTable.profileId, profileId)
        )
      : and(eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt));

    const [threadStats] = await db
      .select({
        total: count(),
        archived: sql<number>`sum(case when ${threadsTable.archived} then 1 else 0 end)`,
        oldest: min(threadsTable.createdAt),
        newest: max(threadsTable.createdAt),
      })
      .from(threadsTable)
      .where(baseWhere);

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
      .where(baseWhere);

    // Per-profile breakdown (only when fetching global stats, i.e. no profileId filter)
    let profileBreakdown: Array<{
      id: number;
      name: string;
      emoji: string;
      color: string;
      threadCount: number;
      messageCount: number;
    }> = [];

    if (!profileId) {
      // Fetch all profiles for this user
      const profiles = await db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.userId, userId));

      // For each profile, get thread + message counts
      profileBreakdown = await Promise.all(
        profiles.map(async (profile) => {
          const profileWhere = and(
            eq(threadsTable.userId, userId),
            isNull(threadsTable.deletedAt),
            eq(threadsTable.profileId, profile.id)
          );

          const [tStats] = await db
            .select({ total: count() })
            .from(threadsTable)
            .where(profileWhere);

          const [mStats] = await db
            .select({ total: count() })
            .from(messagesTable)
            .innerJoin(threadsTable, eq(messagesTable.threadId, threadsTable.id))
            .where(profileWhere);

          return {
            id: profile.id,
            name: profile.name,
            emoji: profile.emoji,
            color: profile.color,
            threadCount: Number(tStats?.total ?? 0),
            messageCount: Number(mStats?.total ?? 0),
          };
        })
      );
    }

    res.json({
      totalThreads: total,
      activeThreads: total - archived,
      archivedThreads: archived,
      totalMessages: Number(msgStats?.total ?? 0),
      userMessages: Number(msgStats?.user ?? 0),
      assistantMessages: Number(msgStats?.assistant ?? 0),
      oldestThreadAt: threadStats?.oldest ? threadStats.oldest.toISOString() : null,
      newestThreadAt: threadStats?.newest ? threadStats.newest.toISOString() : null,
      ...(profileId === undefined ? { profiles: profileBreakdown } : {}),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
