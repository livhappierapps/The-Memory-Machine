import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ensureOAuthCodeSchema, consumeAuthorizationCode } from "../lib/oauth-code-store";
import {
  hashRefreshToken,
  issueRefreshToken,
  rotateRefreshToken,
  sqlRefreshTokenRepository as repo,
} from "../lib/oauth-refresh-store";

// Uses the existing oauth_authorization_codes table only (no schema change).
const userId = `oauth-refresh-fixture-${randomUUID()}`;
const clientId = "https://grok.com/oauth/mcp-client.json";
const accessToken = "fixture-access-token";
const scope = ["memories:read", "memories:write"];
const loadAccessToken = async () => accessToken;

beforeAll(ensureOAuthCodeSchema);
afterAll(async () => {
  await db.execute(sql`DELETE FROM oauth_authorization_codes WHERE user_id = ${userId}`);
});

describe("durable OAuth refresh tokens", () => {
  it("stores only a prefixed hash in the existing table", async () => {
    const token = await issueRefreshToken(repo, { userId, clientId, scope, accessToken });
    const rows = await db.execute(sql`
      SELECT code_hash, code_challenge, redirect_uri FROM oauth_authorization_codes
      WHERE user_id = ${userId}
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.code_hash).toBe(`rt:${hashRefreshToken(token)}`);
    expect(JSON.stringify(rows.rows)).not.toContain(token);
    expect(String(rows.rows[0]?.code_challenge)).toMatch(/^rt1\|active\|[0-9a-f]{16}\|memories:read memories:write$/);
  });

  it("cannot be redeemed as an authorization code", async () => {
    const token = await issueRefreshToken(repo, { userId, clientId, scope, accessToken });
    expect(await consumeAuthorizationCode(token)).toBeNull();
    expect((await repo.find(hashRefreshToken(token)))?.status).toBe("active");
  });

  it("rotates exactly once under concurrent redemption and revokes the family", async () => {
    const token = await issueRefreshToken(repo, { userId, clientId, scope, accessToken });
    const results = await Promise.all([
      rotateRefreshToken(repo, { refreshToken: token, clientId, loadAccessToken }),
      rotateRefreshToken(repo, { refreshToken: token, clientId, loadAccessToken }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const winner = results.find((r) => r.ok);
    expect((await repo.find(hashRefreshToken(token)))?.status).not.toBe("active");
    // The losing request is treated as reuse, so the whole family is revoked.
    if (winner?.ok) {
      expect((await repo.find(hashRefreshToken(winner.refreshToken)))?.status).toBe("revoked");
    }
  });

  it("rotates, rejects the old token and revokes the family on reuse", async () => {
    const first = await issueRefreshToken(repo, { userId, clientId, scope, accessToken });
    const ok = await rotateRefreshToken(repo, { refreshToken: first, clientId, loadAccessToken });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect((await repo.find(hashRefreshToken(first)))?.status).toBe("used");
    expect((await repo.find(hashRefreshToken(ok.refreshToken)))?.status).toBe("active");
    const reuse = await rotateRefreshToken(repo, { refreshToken: first, clientId, loadAccessToken });
    expect(reuse.ok).toBe(false);
    expect((await repo.find(hashRefreshToken(ok.refreshToken)))?.status).toBe("revoked");
  });

  it("rejects expired tokens using database time", async () => {
    const token = await issueRefreshToken(repo, { userId, clientId, scope, accessToken });
    await db.execute(sql`
      UPDATE oauth_authorization_codes SET expires_at = NOW() - INTERVAL '1 second'
      WHERE code_hash = ${`rt:${hashRefreshToken(token)}`}
    `);
    expect((await repo.find(hashRefreshToken(token)))?.expired).toBe(true);
    expect(await repo.markUsedIfActive(hashRefreshToken(token))).toBe(false);
    const res = await rotateRefreshToken(repo, { refreshToken: token, clientId, loadAccessToken });
    expect(res.ok).toBe(false);
  });
});
