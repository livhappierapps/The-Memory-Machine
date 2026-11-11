import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sha256Hex } from "../lib/field-crypto";
import { ensureOAuthCodeSchema, storeAuthorizationCode, consumeAuthorizationCode } from "../lib/oauth-code-store";

const issued: string[] = [];
const entry = {
  userId: `oauth-store-fixture-${randomUUID()}`,
  clientId: "grok-fixture",
  redirectUri: "https://grok.com/connectors/callback",
  codeChallenge: "a".repeat(43),
  codeChallengeMethod: "S256",
};
beforeAll(ensureOAuthCodeSchema);
afterAll(async () => {
  for (const code of issued) {
    await db.execute(sql`DELETE FROM oauth_authorization_codes WHERE code_hash = ${sha256Hex(code)}`);
  }
});

describe("durable OAuth authorization codes", () => {
  it("stores only a hash and allows exactly one concurrent exchange", async () => {
    const code = randomUUID();
    issued.push(code);
    await storeAuthorizationCode(code, entry);
    const stored = await db.execute(sql`
      SELECT code_hash FROM oauth_authorization_codes WHERE user_id = ${entry.userId}
    `);
    expect(stored.rows[0]?.code_hash).toBe(sha256Hex(code));
    expect(stored.rows[0]?.code_hash).not.toBe(code);
    const results = await Promise.all([consumeAuthorizationCode(code), consumeAuthorizationCode(code)]);
    expect(results.filter(Boolean)).toEqual([entry]);
  });
  it("rejects expired codes using database time", async () => {
    const code = randomUUID();
    issued.push(code);
    await storeAuthorizationCode(code, entry);
    await db.execute(sql`
      UPDATE oauth_authorization_codes SET expires_at = NOW() - INTERVAL '1 second'
      WHERE code_hash = ${sha256Hex(code)}
    `);
    expect(await consumeAuthorizationCode(code)).toBeNull();
  });
});
