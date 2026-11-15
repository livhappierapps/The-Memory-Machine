import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sha256Hex } from "../lib/field-crypto";

/** Resolve a plain-text MCP bearer token to its owning userId. */
export async function getUserIdByMcpToken(token: string): Promise<string | null> {
  const tokenHash = sha256Hex(token);

  // Primary: hash-based lookup (post-migration tokens)
  const [byHash] = await db
    .select({ userId: settingsTable.userId })
    .from(settingsTable)
    .where(eq(settingsTable.mcpTokenHash, tokenHash))
    .limit(1);
  if (byHash) return byHash.userId;

  // Fallback: plaintext lookup for pre-migration rows not yet visited by getOrCreateSettings
  const [byPlain] = await db
    .select({ userId: settingsTable.userId })
    .from(settingsTable)
    .where(eq(settingsTable.mcpToken, token))
    .limit(1);
  return byPlain?.userId ?? null;
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Express middleware that accepts either:
 *   - An MCP bearer token  (resolves userId from the settings table hash lookup)
 *   - A Clerk session      (resolves userId from session claims)
 *
 * Both paths preserve full user scoping — the token/session is always resolved to
 * the owner's userId before the handler runs. Returns 401 if neither validates.
 *
 * Use on endpoints that must be reachable from both the Leo mobile app (MCP token)
 * and the web dashboard (Clerk session), such as GET /messages/recent.
 */
export async function requireMcpOrAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // 1. Try MCP bearer token first
  const token = extractBearerToken(req);
  if (token) {
    try {
      const userId = await getUserIdByMcpToken(token);
      if (userId) {
        req.userId = userId;
        next();
        return;
      }
    } catch {
      // Token lookup failed — fall through to Clerk auth
    }
  }

  // 2. Fall back to Clerk session auth
  try {
    const auth = getAuth(req);
    const userId = (auth?.sessionClaims?.userId as string | undefined) || auth?.userId;
    if (userId) {
      req.userId = userId;
      next();
      return;
    }
  } catch {
    // getAuth throws when Clerk middleware hasn't run (e.g. test environments).
    // Fall through to 401.
  }

  res.status(401).json({ error: "Unauthorized" });
}
