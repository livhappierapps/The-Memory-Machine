import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { userKeyphrasesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { encryptText, decryptText } from "../lib/crypto-utils";
import { clerkClient } from "@clerk/express";
import bcrypt from "bcryptjs";

const router: IRouter = Router();

async function hasMfaEnabled(userId: string): Promise<boolean> {
  try {
    const user = await clerkClient.users.getUser(userId);
    return user.totpEnabled || user.backupCodeEnabled || (user.phoneNumbers?.some((p) => p.reservedForSecondFactor) ?? false);
  } catch {
    return false;
  }
}

router.get("/security/keyphrase", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const [kp] = await db
      .select({ id: userKeyphrasesTable.id, createdAt: userKeyphrasesTable.createdAt })
      .from(userKeyphrasesTable)
      .where(eq(userKeyphrasesTable.userId, userId));

    const mfaEnabled = await hasMfaEnabled(userId);
    res.json({ hasKeyphrase: !!kp, mfaEnabled, createdAt: kp?.createdAt ?? null });
  } catch (err) {
    req.log.error({ err }, "Failed to get keyphrase status");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/security/keyphrase", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { keyphrase } = req.body as { keyphrase?: string };

    if (!keyphrase || keyphrase.trim().length < 6) {
      res.status(400).json({ error: "Keyphrase must be at least 6 characters" });
      return;
    }

    const mfaEnabled = await hasMfaEnabled(userId);
    if (!mfaEnabled) {
      res.status(403).json({
        error: "two_factor_required",
        message: "You must enable two-factor authentication before setting a keyphrase.",
      });
      return;
    }

    const bcryptHash = await bcrypt.hash(keyphrase, 12);
    const encryptedPlaintext = encryptText(keyphrase);

    const [existing] = await db
      .select({ id: userKeyphrasesTable.id })
      .from(userKeyphrasesTable)
      .where(eq(userKeyphrasesTable.userId, userId));

    if (existing) {
      await db.update(userKeyphrasesTable).set({ bcryptHash, encryptedPlaintext }).where(eq(userKeyphrasesTable.userId, userId));
    } else {
      await db.insert(userKeyphrasesTable).values({ userId, bcryptHash, encryptedPlaintext });
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to set keyphrase");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/security/keyphrase/verify", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { keyphrase } = req.body as { keyphrase?: string };

    if (!keyphrase) {
      res.status(400).json({ error: "Keyphrase required" });
      return;
    }

    const [kp] = await db
      .select({ bcryptHash: userKeyphrasesTable.bcryptHash })
      .from(userKeyphrasesTable)
      .where(eq(userKeyphrasesTable.userId, userId));

    if (!kp) {
      res.json({ valid: true, hasKeyphrase: false });
      return;
    }

    const valid = await bcrypt.compare(keyphrase, kp.bcryptHash);
    res.json({ valid, hasKeyphrase: true });
  } catch (err) {
    req.log.error({ err }, "Failed to verify keyphrase");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
