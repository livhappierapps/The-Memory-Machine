/**
 * Clerk webhook receiver.
 *
 * Listens for `session.created` events from Clerk and records a `sign_in`
 * audit event so users can see every sign-in in their Activity Log.
 *
 * Setup:
 *   1. Set CLERK_WEBHOOK_SECRET in your environment (from Clerk Dashboard →
 *      Webhooks → your endpoint → Signing Secret).
 *   2. In the Clerk Dashboard add a webhook endpoint pointing at:
 *         https://<your-domain>/api/webhooks/clerk
 *      and subscribe to the `session.created` event.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { Webhook } from "svix";
import { db } from "@workspace/db";
import { auditEventsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Clerk sends the raw body for signature verification — we must use the raw
// Buffer before express.json() has a chance to parse it.
router.post(
  "/webhooks/clerk",
  // We need the raw body for svix signature verification.
  // This route is mounted before express.json(), so req.body is a Buffer when
  // express.raw() is applied here.
  (req, _res, next) => {
    // If the body was already parsed as JSON (e.g. in dev mode without raw middleware),
    // coerce back to a string so svix can verify.
    if (Buffer.isBuffer(req.body)) return next();
    // Fallthrough — body may have already been parsed as JSON at the app level.
    next();
  },
  async (req: Request, res: Response) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;

    if (!secret) {
      // Webhook secret not configured — accept but do nothing.
      // This allows the server to boot cleanly without the secret set.
      res.json({ ok: true, skipped: true });
      return;
    }

    // svix requires the raw body as a string or Buffer.
    const payload =
      Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : JSON.stringify(req.body);

    const svixId = req.headers["svix-id"] as string | undefined;
    const svixTs = req.headers["svix-timestamp"] as string | undefined;
    const svixSig = req.headers["svix-signature"] as string | undefined;

    if (!svixId || !svixTs || !svixSig) {
      res.status(400).json({ error: "Missing svix headers" });
      return;
    }

    let event: { type: string; data: Record<string, unknown> };
    try {
      const wh = new Webhook(secret);
      event = wh.verify(payload, {
        "svix-id": svixId,
        "svix-timestamp": svixTs,
        "svix-signature": svixSig,
      }) as typeof event;
    } catch (err) {
      logger.warn({ err }, "Clerk webhook signature verification failed");
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    if (event.type === "session.created") {
      try {
        const userId = event.data.user_id as string | undefined;
        if (userId) {
          const ip =
            (req.headers["x-forwarded-for"] as string | undefined)
              ?.split(",")[0]
              ?.trim() ??
            req.ip ??
            null;

          await db.insert(auditEventsTable).values({
            userId,
            action: "sign_in",
            metadata: {
              sessionId: event.data.id,
              clientId: event.data.client_id,
            },
            ip,
          });
        }
      } catch (err) {
        // Non-fatal — log but still return 200 so Clerk doesn't retry forever.
        logger.warn({ err }, "Failed to insert sign_in audit event");
      }
    }

    res.json({ ok: true });
  },
);

export default router;
