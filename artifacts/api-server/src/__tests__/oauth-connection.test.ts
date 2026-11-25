import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";

const codes = vi.hoisted(() => ({ store: vi.fn(), consume: vi.fn() }));
vi.mock("../lib/oauth-code-store", () => ({
  storeAuthorizationCode: codes.store,
  consumeAuthorizationCode: codes.consume,
}));
// In-memory refresh-token storage: the real rotation/reuse policy runs on top.
const rt = vi.hoisted(() => {
  type Row = {
    userId: string; clientId: string; familyId: string; scope: string[];
    accessFingerprint: string; status: "active" | "used" | "revoked"; expiresAt: number;
  };
  const rows = new Map<string, Row>();
  const repo = {
    async insert(hash: string, r: Omit<Row, "status" | "expiresAt">) {
      rows.set(hash, { ...r, status: "active", expiresAt: Date.now() + 60 * 86_400_000 });
    },
    async find(hash: string) {
      const r = rows.get(hash);
      if (!r) return null;
      const { expiresAt, ...rest } = r;
      return { ...rest, scope: [...r.scope], expired: expiresAt <= Date.now() };
    },
    async markUsedIfActive(hash: string) {
      const r = rows.get(hash);
      if (!r || r.status !== "active" || r.expiresAt <= Date.now()) return false;
      r.status = "used";
      return true;
    },
    async revokeFamily(familyId: string) {
      for (const r of rows.values()) if (r.familyId === familyId) r.status = "revoked";
    },
  };
  return { rows, repo };
});
vi.mock("../lib/oauth-refresh-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/oauth-refresh-store")>()),
  sqlRefreshTokenRepository: rt.repo,
}));
const crypto = vi.hoisted(() => ({ decrypt: vi.fn(() => "fixture-memory-token") }));
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
  decryptField: crypto.decrypt,
}));
vi.mock("../routes/settings", () => ({
  getOrCreateSettings: vi.fn().mockResolvedValue({}),
}));

import oauth from "../routes/oauth";
import discovery from "../routes/oauth-discovery";
import { isAllowedOAuthClient } from "../lib/oauth-validation";
import { MCP_OAUTH_ORIGIN, MCP_RESOURCE } from "../lib/mcp-oauth-config";
import { getOrCreateSettings } from "../routes/settings";
import { hashRefreshToken } from "../lib/oauth-refresh-store";

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
  rt.rows.clear();
  crypto.decrypt.mockReturnValue("fixture-memory-token");
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

describe("Grok OAuth refresh tokens", () => {
  async function connect() {
    codes.consume.mockResolvedValueOnce(entry);
    const res = await request(app).post("/api/oauth/token").type("form").send(exchange);
    expect(res.status).toBe(200);
    return res.body as { access_token: string; refresh_token: string; expires_in: number; scope: string };
  }
  function refresh(refresh_token: string, extra: Record<string, string> = {}) {
    return request(app).post("/api/oauth/token").type("form").send({
      grant_type: "refresh_token", client_id: authorization.client_id, refresh_token, ...extra,
    });
  }

  it("advertises the refresh_token grant alongside authorization_code", async () => {
    const res = await request(app).get("/.well-known/oauth-authorization-server");
    expect(res.body.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(res.body.response_types_supported).toEqual(["code"]);
    expect(res.body.token_endpoint).toBe(`${MCP_OAUTH_ORIGIN}/api/oauth/token`);
    expect(res.body.scopes_supported).toEqual(["memories:read", "memories:write"]);
  });

  it("issues a refresh token and expiry on code exchange, storing only its hash", async () => {
    const body = await connect();
    expect(body.access_token).toBe("fixture-memory-token");
    expect(body.expires_in).toBeGreaterThan(0);
    expect(body.scope).toBe("memories:read memories:write");
    expect(body.refresh_token).toMatch(/^mmrt_[A-Za-z0-9_-]{43}$/);
    expect([...rt.rows.keys()]).toEqual([hashRefreshToken(body.refresh_token)]);
    expect(JSON.stringify([...rt.rows.entries()])).not.toContain(body.refresh_token);
    const [row] = rt.rows.values();
    expect(row).toMatchObject({ userId: entry.userId, clientId: entry.clientId, status: "active" });
  });

  it("does not issue a refresh token when the code exchange fails", async () => {
    codes.consume.mockResolvedValueOnce(entry);
    const res = await request(app).post("/api/oauth/token").send({ ...exchange, code_verifier: "b".repeat(64) });
    expect(res.status).toBe(400);
    expect(res.body.refresh_token).toBeUndefined();
    expect(rt.rows.size).toBe(0);
  });

  it("refreshes with the same client and returns a rotated refresh token", async () => {
    const first = await connect();
    const res = await refresh(first.refresh_token);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.access_token).toBe("fixture-memory-token");
    expect(res.body.token_type).toBe("Bearer");
    expect(res.body.expires_in).toBeGreaterThan(0);
    expect(res.body.scope).toBe("memories:read memories:write");
    expect(res.body.refresh_token).toMatch(/^mmrt_/);
    expect(res.body.refresh_token).not.toBe(first.refresh_token);
    // The rotated token keeps working, again and again.
    const again = await refresh(res.body.refresh_token);
    expect(again.status).toBe(200);
  });

  it("rejects the old refresh token after rotation", async () => {
    const first = await connect();
    expect((await refresh(first.refresh_token)).status).toBe(200);
    const old = await refresh(first.refresh_token);
    expect(old.status).toBe(400);
    expect(old.body.error).toBe("invalid_grant");
    expect(old.body.access_token).toBeUndefined();
  });

  it("revokes the whole token family when a rotated token is reused", async () => {
    const first = await connect();
    const second = (await refresh(first.refresh_token)).body.refresh_token as string;
    expect((await refresh(first.refresh_token)).status).toBe(400); // replay of a stolen token
    const legit = await refresh(second);
    expect(legit.status).toBe(400);
    expect(legit.body.error).toBe("invalid_grant");
    expect([...rt.rows.values()].every((r) => r.status !== "active")).toBe(true);
  });

  it("only revokes the affected family, not other connections", async () => {
    const a = await connect();
    const b = await connect();
    await refresh(a.refresh_token);
    await refresh(a.refresh_token); // reuse → revoke family A
    expect((await refresh(b.refresh_token)).status).toBe(200);
  });

  it("rejects a refresh token presented by a different client_id without consuming it", async () => {
    const first = await connect();
    const wrong = await refresh(first.refresh_token, { client_id: "https://attacker.invalid/client.json" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("invalid_grant");
    const missing = await request(app).post("/api/oauth/token").type("form")
      .send({ grant_type: "refresh_token", refresh_token: first.refresh_token });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("invalid_request");
    expect((await refresh(first.refresh_token)).status).toBe(200);
  });

  it("rejects an expired refresh token", async () => {
    const first = await connect();
    for (const r of rt.rows.values()) r.expiresAt = Date.now() - 1000;
    const res = await refresh(first.refresh_token);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
  });

  it("rejects unknown, malformed or missing refresh tokens", async () => {
    expect((await refresh("mmrt_" + "x".repeat(43))).body.error).toBe("invalid_grant");
    expect((await refresh("not-a-token")).body.error).toBe("invalid_grant");
    expect((await refresh("")).body.error).toBe("invalid_request");
  });

  it("allows narrowing the scope but never widening it", async () => {
    const first = await connect();
    const narrow = await refresh(first.refresh_token, { scope: "memories:read" });
    expect(narrow.status).toBe(200);
    expect(narrow.body.scope).toBe("memories:read");
    const widen = await refresh(narrow.body.refresh_token, { scope: "memories:read memories:write" });
    expect(widen.status).toBe(400);
    expect(widen.body.error).toBe("invalid_scope");
    const bogus = await refresh(narrow.body.refresh_token, { scope: "admin" });
    expect(bogus.body.error).toBe("invalid_scope");
    // A rejected scope request does not burn the token.
    const kept = await refresh(narrow.body.refresh_token);
    expect(kept.status).toBe(200);
    expect(kept.body.scope).toBe("memories:read");
  });

  it("keeps the MCP resource binding on refresh", async () => {
    const first = await connect();
    const bad = await refresh(first.refresh_token, { resource: "https://attacker.invalid/mcp" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_target");
    expect((await refresh(first.refresh_token, { resource: MCP_RESOURCE })).status).toBe(200);
  });

  it("stops refreshing once the user regenerates their MCP token", async () => {
    const first = await connect();
    crypto.decrypt.mockReturnValue("regenerated-memory-token");
    const res = await refresh(first.refresh_token);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
  });
});
