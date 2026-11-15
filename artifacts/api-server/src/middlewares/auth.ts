import type { Request, Response } from "express";
import { getAuth } from "@clerk/express";

/**
 * Express middleware — validates a Clerk session and attaches `req.userId`.
 * Returns 401 if the request is unauthenticated.
 */
export function requireAuth(req: Request, res: Response, next: () => void): void {
  let userId: string | undefined;
  try {
    const auth = getAuth(req);
    const claimedUserId = auth?.sessionClaims?.userId;
    userId =
      (typeof claimedUserId === "string" && claimedUserId) ||
      (typeof auth?.userId === "string" && auth.userId) ||
      undefined;
  } catch {
    // If Clerk context is unavailable or invalid, never continue as authenticated.
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}
