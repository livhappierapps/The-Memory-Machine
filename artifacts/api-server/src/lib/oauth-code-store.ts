import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sha256Hex } from "./field-crypto";

export interface AuthorizationCodeEntry {
  userId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  clientId: string;
}

export async function ensureOAuthCodeSchema() {
  // Read-only startup check: production schema is applied by Publish.
  await db.execute(sql`
    SELECT code_hash, user_id, client_id, redirect_uri, code_challenge, expires_at
    FROM oauth_authorization_codes LIMIT 0
  `);
}

export async function storeAuthorizationCode(code: string, entry: AuthorizationCodeEntry) {
  await db.execute(sql`DELETE FROM oauth_authorization_codes WHERE expires_at <= NOW()`);
  await db.execute(sql`
    INSERT INTO oauth_authorization_codes
      (code_hash, user_id, client_id, redirect_uri, code_challenge, expires_at)
    VALUES (${sha256Hex(code)}, ${entry.userId}, ${entry.clientId},
      ${entry.redirectUri}, ${entry.codeChallenge}, NOW() + INTERVAL '5 minutes')
  `);
}

export async function consumeAuthorizationCode(code: string): Promise<AuthorizationCodeEntry | null> {
  const result = await db.execute(sql`
    DELETE FROM oauth_authorization_codes
    WHERE code_hash = ${sha256Hex(code)} AND expires_at > NOW()
    RETURNING user_id AS "userId", client_id AS "clientId",
      redirect_uri AS "redirectUri", code_challenge AS "codeChallenge"
  `);
  const row = result.rows[0];
  return row ? {
    userId: String(row.userId),
    clientId: String(row.clientId),
    redirectUri: String(row.redirectUri),
    codeChallenge: String(row.codeChallenge),
    codeChallengeMethod: "S256",
  } : null;
}
