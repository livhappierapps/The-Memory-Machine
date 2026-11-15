import type { Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { resolveDataUserId } from "../lib/legacy-user-map";

/**
 * Express middleware — validates a Clerk session and attaches `req.userId`
 * (data/encryption user ID) and `req.clerkUserId` (Clerk account ID).
 * Returns 401 if the request is unauthenticated.
 *
 * A `userId` session claim, when present, is used as-is. Otherwise the Clerk
 * user ID is passed through the optional legacy mapping (LEGACY_USER_MAPPING).
 */
export function requireAuth(req: Request, res: Response, next: () => void): void {
  let claimUserId: string | undefined;
  let clerkUserId: string | undefined;
  try {
    const auth = getAuth(req);
    const claimedUserId = auth?.sessionClaims?.userId;
    claimUserId = (typeof claimedUserId === "string" && claimedUserId) || undefined;
    clerkUserId = (typeof auth?.userId === "string" && auth.userId) || undefined;
  } catch {
    // If Clerk context is unavailable or invalid, never continue as authenticated.
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!claimUserId && !clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.clerkUserId = clerkUserId ?? claimUserId;
  if (claimUserId) {
    req.userId = claimUserId;
    next();
    return;
  }
  resolveDataUserId(clerkUserId!).then(
    (dataUserId) => {
      req.userId = dataUserId;
      next();
    },
    () => {
      res.status(401).json({ error: "Unauthorized" });
    },
  );
}
