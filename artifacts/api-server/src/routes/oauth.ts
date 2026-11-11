/**
 * oauth.ts — OAuth 2.0 Authorization Code + PKCE server for Memory Machine.
 *
 * Grok's connector form (and any MCP client) can authenticate via OAuth instead
 * of manually copying a Bearer token. Flow:
 *
 *  1. Grok → GET /api/oauth/authorize?response_type=code&client_id=X
 *            &redirect_uri=Y&code_challenge=Z&code_challenge_method=S256&state=W
 *  2. Server → 302 to frontend /oauth/authorize?{same params}
 *  3. User logs in via Clerk and clicks "Allow"
 *  4. Frontend → POST /api/oauth/code  { client_id, redirect_uri, code_challenge, state }
 *  5. Server → { code, state }
 *  6. Frontend → 302 to redirect_uri?code=CODE&state=STATE
 *  7. Grok → POST /api/oauth/token  { grant_type=authorization_code, code, code_verifier,
 *                                     client_id, redirect_uri }
 *  8. Server verifies PKCE, returns { access_token: mcpToken, token_type: "Bearer" }
 *  9. Grok uses Bearer <mcpToken> for all MCP calls → works with existing auth ✓
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID, createHash } from "crypto";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { decryptField } from "../lib/field-crypto";
import { logger } from "../lib/logger";
import { isAllowedOAuthClient, isAllowedOAuthRedirectUri, isValidPkceChallenge } from "../lib/oauth-validation";
import { consumeAuthorizationCode, storeAuthorizationCode } from "../lib/oauth-code-store";
import { MCP_RESOURCE } from "../lib/mcp-oauth-config";
import { getOrCreateSettings } from "./settings";

const router: IRouter = Router();

// ── CORS helper for token endpoint (Grok backend calls this cross-origin) ──────
function setCorsHeaders(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ── OPTIONS preflight ─────────────────────────────────────────────────────────
router.options(["/oauth/authorize", "/oauth/token", "/oauth/code"], (req: Request, res: Response) => {
  setCorsHeaders(res);
  res.sendStatus(204);
});

// ── GET /api/oauth/authorize ──────────────────────────────────────────────────
// Grok redirects the user here. We forward to the frontend consent page.
router.get("/oauth/authorize", async (req: Request, res: Response) => {
  const clientId = typeof req.query.client_id === "string" ? req.query.client_id : "";
  const redirectUri = typeof req.query.redirect_uri === "string" ? req.query.redirect_uri : "";
  const codeChallenge = typeof req.query.code_challenge === "string" ? req.query.code_challenge : "";
  const method = typeof req.query.code_challenge_method === "string"
    ? req.query.code_challenge_method
    : "S256";
  const responseType = typeof req.query.response_type === "string"
    ? req.query.response_type
    : "code";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (
    !clientId ||
    clientId.length > 2048 ||
    responseType !== "code" ||
    !isAllowedOAuthRedirectUri(redirectUri) ||
    method !== "S256" ||
    !isValidPkceChallenge(codeChallenge) ||
    state.length > 1024
  ) {
    res.status(400).json({ error: "invalid_request", error_description: "Invalid OAuth authorization request" });
    return;
  }

  if (req.query.resource && req.query.resource !== MCP_RESOURCE) {
    res.status(400).json({ error: "invalid_target" });
    return;
  }
  if (!await isAllowedOAuthClient(clientId, redirectUri)) {
    res.status(400).json({ error: "invalid_client", error_description: "Client metadata or callback could not be verified" });
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (state) params.set("state", state);
  // Redirect to frontend consent page (same domain, different path served by Vite)
  res.redirect(302, `/oauth/authorize?${params.toString()}`);
});

// ── POST /api/oauth/code ──────────────────────────────────────────────────────
// Called by the frontend consent page after the user clicks "Allow".
// Requires the user to be authenticated via Clerk.
router.post("/oauth/code", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const client_id = typeof body.client_id === "string" ? body.client_id : "";
    const redirect_uri = typeof body.redirect_uri === "string" ? body.redirect_uri : "";
    const code_challenge = typeof body.code_challenge === "string" ? body.code_challenge : "";
    const code_challenge_method = typeof body.code_challenge_method === "string"
      ? body.code_challenge_method
      : "S256";
    const state = typeof body.state === "string" ? body.state : "";

    if (
      !client_id ||
      client_id.length > 2048 ||
      !isAllowedOAuthRedirectUri(redirect_uri) ||
      code_challenge_method !== "S256" ||
      !isValidPkceChallenge(code_challenge) ||
      state.length > 1024
    ) {
      res.status(400).json({ error: "invalid_request", error_description: "Invalid OAuth authorization request" });
      return;
    }

    if (!await isAllowedOAuthClient(client_id, redirect_uri)) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }

    // A first-time Grok connection should not require visiting Settings first.
    // This initializes a missing token but never rotates an existing one.
    await getOrCreateSettings(userId);
    const code = randomUUID();
    await storeAuthorizationCode(code, {
      userId,
      codeChallenge: code_challenge,
      codeChallengeMethod: "S256",
      redirectUri: redirect_uri,
      clientId: client_id,
    });

    logger.info({ userId, clientId: client_id }, "OAuth auth code issued");
    res.json({ code, state: state ?? null });
  } catch (err) {
    logger.error({ err }, "oauth /code error");
    res.status(500).json({ error: "server_error" });
  }
});

// ── POST /api/oauth/token ─────────────────────────────────────────────────────
// Grok exchanges the auth code + code_verifier for an access token.
// The returned access_token is the user's mcpToken — works with existing MCP auth.
router.post("/oauth/token", async (req: Request, res: Response) => {
  setCorsHeaders(res);

  try {
    const body = req.body as Record<string, unknown>;
    const grant_type = body.grant_type;
    const code = typeof body.code === "string" ? body.code : "";
    const code_verifier = typeof body.code_verifier === "string" ? body.code_verifier : "";
    const client_id = typeof body.client_id === "string" ? body.client_id : "";
    const redirect_uri = typeof body.redirect_uri === "string" ? body.redirect_uri : "";

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    if (body.resource && body.resource !== MCP_RESOURCE) {
      res.status(400).json({ error: "invalid_target" });
      return;
    }

    if (grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }

    if (!code) {
      res.status(400).json({ error: "invalid_request", error_description: "code is required" });
      return;
    }

    const entry = await consumeAuthorizationCode(code);
    if (!entry) {
      res.status(400).json({ error: "invalid_grant", error_description: "Unknown or expired authorization code" });
      return;
    }

    if (
      !client_id ||
      client_id !== entry.clientId ||
      !redirect_uri ||
      redirect_uri !== entry.redirectUri
    ) {
      res.status(400).json({ error: "invalid_grant", error_description: "OAuth client or redirect_uri mismatch" });
      return;
    }

    // PKCE verification (S256)
    if (entry.codeChallengeMethod === "S256") {
      if (!code_verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(code_verifier)) {
        res.status(400).json({ error: "invalid_request", error_description: "code_verifier required for S256" });
        return;
      }
      const computed = createHash("sha256")
        .update(code_verifier)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
      if (computed !== entry.codeChallenge) {
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE code_verifier does not match" });
        return;
      }
    }

    // Fetch the user's MCP token (the access_token we return IS the mcpToken)
    const [settings] = await db
      .select({ mcpToken: settingsTable.mcpToken, userId: settingsTable.userId })
      .from(settingsTable)
      .where(eq(settingsTable.userId, entry.userId))
      .limit(1);

    if (!settings?.mcpToken) {
      res.status(500).json({ error: "server_error", error_description: "No MCP token found for user" });
      return;
    }

    const accessToken = decryptField(entry.userId, settings.mcpToken);

    logger.info({ userId: entry.userId, clientId: entry.clientId }, "OAuth token issued");

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      scope: "memories:read memories:write",
    });
  } catch (err) {
    logger.error({ err }, "oauth /token error");
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
