import type { Request, Response } from "express";
import { getAuth } from "@clerk/express";

/**
 * Express middleware — validates a Clerk session and attaches `req.userId`.
 * Returns 401 if the request is unauthenticated.
 */
export function requireAuth(req: Request, res: Response, next: () => void): void {
  const auth = getAuth(req);
  const userId = (auth?.sessionClaims?.userId as string | undefined) || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}
