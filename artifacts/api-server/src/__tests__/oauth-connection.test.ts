import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";

const codes = vi.hoisted(() => ({ store: vi.fn(), consume: vi.fn() }));
vi.mock("../lib/oauth-code-store", () => ({
  storeAuthorizationCode: codes.store,
  consumeAuthorizationCode: codes.consume,
}));
vi.mock("../middlewares/auth", () => ({
  requireAuth(req: express.Request, res: express.Response, next: () => void) {
    if (req.headers.authorization !== "Bearer fixture-session") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = "oauth-fixture-owner";
    next();
  },
}));
vi.mock("@workspace/db", () => ({
  settingsTable: { mcpToken: "token", userId: "user" },
  db: { select: () => ({
    from: () => ({ where: () => ({ limit: async () => [{ mcpToken: "fixture-ciphertext" }] }) }),
  }) },
}));
vi.mock("../lib/field-crypto", () => ({
  decryptField: () => "fixture-memory-token",
}));
vi.mock("../routes/settings", () => ({
  getOrCreateSettings: vi.fn().mockResolvedValue({}),
}));

import oauth from "../routes/oauth";
import discovery from "../routes/oauth-discovery";
import { isAllowedOAuthClient } from "../lib/oauth-validation";
import { MCP_OAUTH_ORIGIN, MCP_RESOURCE } from "../lib/mcp-oauth-config";
import { getOrCreateSettings } from "../routes/settings";

const app = express();
app.use(express.json(), express.urlencoded({ extended: false }));
app.use(discovery);
app.use("/api", oauth);
const verifier = "a".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const authorization = {
  client_id: "https://grok.com/client-metadata.json",
  redirect_uri: "https://grok.com/connectors/callback",
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "fixture-state",
};
const entry = {
  userId: "oauth-fixture-owner",
  clientId: authorization.client_id,
  redirectUri: authorization.redirect_uri,
  codeChallenge: challenge,
  codeChallengeMethod: "S256",
};
const exchange = {
  grant_type: "authorization_code",
  client_id: authorization.client_id,
  redirect_uri: authorization.redirect_uri,
  code: "fixture-code",
  code_verifier: verifier,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  codes.consume.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({
      client_id: authorization.client_id,
      redirect_uris: [authorization.redirect_uri],
      token_endpoint_auth_method: "none",
    }),
  }));
});

describe("Grok OAuth connection", () => {
  it("serves JSON resource discovery at the path-specific address", async () => {
    const res = await request(app).get("/.well-known/oauth-protected-resource/api/mcp");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.resource).toBe(MCP_RESOURCE);
    expect(res.body.authorization_servers).toEqual([MCP_OAUTH_ORIGIN]);
  });
  it("advertises public-client PKCE and URL client metadata", async () => {
    const res = await request(app).get("/.well-known/oauth-authorization-server");
    expect(res.body.issuer).toBe(MCP_OAUTH_ORIGIN);
    expect(res.body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(res.body.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(res.body.client_id_metadata_document_supported).toBe(true);
  });
  it("requires a signed-in session before consent can issue a code", async () => {
    expect((await request(app).post("/api/oauth/code").send(authorization)).status).toBe(401);
    expect(codes.store).not.toHaveBeenCalled();
  });
  it("uses the userId attached by the authentication middleware", async () => {
    const res = await request(app).post("/api/oauth/code")
      .set("Authorization", "Bearer fixture-session").send(authorization);
    expect(res.status).toBe(200);
    expect(codes.store).toHaveBeenCalledWith(expect.any(String), entry);
    expect(getOrCreateSettings).toHaveBeenCalledWith("oauth-fixture-owner");
    expect(res.body.state).toBe("fixture-state");
  });
  it("rejects an untrusted callback before redirecting", async () => {
    const res = await request(app).get("/api/oauth/authorize")
      .query({ ...authorization, redirect_uri: "https://attacker.invalid/callback" });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });
  it("rejects an unrelated target resource", async () => {
    expect((await request(app).get("/api/oauth/authorize")
      .query({ ...authorization, resource: "https://attacker.invalid/mcp" })).status).toBe(400);
    expect((await request(app).post("/api/oauth/token")
      .send({ ...exchange, resource: "https://attacker.invalid/mcp" })).status).toBe(400);
    expect(codes.consume).not.toHaveBeenCalled();
  });
  it("exchanges a valid PKCE code using form encoding without caching the token", async () => {
    codes.consume.mockResolvedValueOnce(entry);
    const res = await request(app).post("/api/oauth/token").type("form").send(exchange);
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBe("fixture-memory-token");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
  it("rejects a wrong verifier and a replayed code", async () => {
    codes.consume.mockResolvedValueOnce(entry).mockResolvedValueOnce(null);
    const wrong = await request(app).post("/api/oauth/token")
      .send({ ...exchange, code_verifier: "b".repeat(64) });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("invalid_grant");
    const replay = await request(app).post("/api/oauth/token").send(exchange);
    expect(replay.status).toBe(400);
  });
  it("does not fetch client metadata from arbitrary or local hosts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await isAllowedOAuthClient("https://attacker.invalid/client.json", authorization.redirect_uri)).toBe(false);
    expect(await isAllowedOAuthClient("http://127.0.0.1/client.json", authorization.redirect_uri)).toBe(false);
    expect(await isAllowedOAuthClient("https://127.0.0.1/client.json", authorization.redirect_uri)).toBe(false);
    expect(await isAllowedOAuthClient("https://grok.com:8443/client.json", authorization.redirect_uri)).toBe(false);
    expect(await isAllowedOAuthClient("unregistered-client", authorization.redirect_uri)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("checks Grok client metadata against the exact callback", async () => {
    const id = "https://grok.com/client-metadata.json";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        client_id: id, redirect_uris: [authorization.redirect_uri], token_endpoint_auth_method: "none",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await isAllowedOAuthClient(id, authorization.redirect_uri)).toBe(true);
    expect(await isAllowedOAuthClient(id, "https://grok.com/different-callback")).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(id, expect.objectContaining({ redirect: "error" }));
  });
});
