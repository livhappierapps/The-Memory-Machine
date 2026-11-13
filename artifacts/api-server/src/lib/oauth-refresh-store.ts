/**
 * oauth-refresh-store.ts — OAuth 2.1 refresh tokens for the MCP connector.
 *
 * Grok (a public client, token_endpoint_auth_method "none") gets a refresh
 * token with every access token so the connector can stay connected instead
 * of asking the user to sign in again.
 *
 * Storage: NO new tables or columns. Refresh tokens live in the existing
 * `oauth_authorization_codes` table, distinguished from authorization codes
 * by a key prefix that an authorization-code lookup can never produce:
 *
 *   code_hash      = "rt:" + sha256(refresh_token)   (hash only, never the token)
 *   user_id        = owner
 *   client_id      = OAuth client the token was issued to
 *   redirect_uri   = "rt-family:<familyId>"          (rotation family)
 *   code_challenge = "rt1|<status>|<accessFingerprint>|<scope>"
 *   expires_at     = sliding lifetime (renewed on every rotation)
 *
 * consumeAuthorizationCode() looks rows up by plain sha256 hex, which never
 * starts with "rt:", so a refresh token can never be redeemed as a code.
 *
 * Security properties:
 *  - Rotation: every successful refresh marks the presented token "used"
 *    (atomically) and issues a new one in the same family.
 *  - Reuse detection: presenting a used/revoked token revokes the family.
 *  - Client binding: client_id must match the client the token was issued to.
 *  - Scope: preserved, or narrowed to a subset; never widened.
 *  - MCP token binding: if the user regenerates their MCP token in Settings,
 *    existing refresh tokens stop working (the family is revoked).
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const REFRESH_TOKEN_TTL_DAYS = 60;
/** Advertised access-token lifetime; drives how often clients refresh. */
export const ACCESS_TOKEN_EXPIRES_IN = 3600;
export const OAUTH_SCOPES = ["memories:read", "memories:write"] as const;

const ROW_KEY_PREFIX = "rt:";
const FAMILY_PREFIX = "rt-family:";
const TOKEN_PREFIX = "mmrt_";
const MAX_TOKEN_LENGTH = 512;

export type RefreshTokenStatus = "active" | "used" | "revoked";

export interface RefreshTokenRecord {
  userId: string;
  clientId: string;
  familyId: string;
  status: RefreshTokenStatus;
  scope: string[];
  accessFingerprint: string;
  expired: boolean;
}

export interface NewRefreshTokenRecord {
  userId: string;
  clientId: string;
  familyId: string;
  scope: string[];
  accessFingerprint: string;
}

/** Storage primitives. The policy below is storage-agnostic. */
export interface RefreshTokenRepository {
  insert(tokenHash: string, record: NewRefreshTokenRecord): Promise<void>;
  /** Returns the record even when expired or no longer active. */
  find(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Atomically flips active → used. Returns false if it was not active/unexpired. */
  markUsedIfActive(tokenHash: string): Promise<boolean>;
  revokeFamily(familyId: string): Promise<void>;
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Short fingerprint of the access token (MCP token) a family is bound to. */
export function accessTokenFingerprint(accessToken: string): string {
  return createHash("sha256").update(accessToken, "utf8").digest("hex").slice(0, 16);
}

function encodeMeta(status: RefreshTokenStatus, fp: string, scope: string[]): string {
  return `rt1|${status}|${fp}|${scope.join(" ")}`;
}

function decodeMeta(meta: string): { status: RefreshTokenStatus; fp: string; scope: string[] } | null {
  const parts = meta.split("|");
  if (parts.length !== 4 || parts[0] !== "rt1") return null;
  const status = parts[1];
  if (status !== "active" && status !== "used" && status !== "revoked") return null;
  return { status, fp: parts[2], scope: parts[3].split(" ").filter(Boolean) };
}

// ── Postgres repository (existing oauth_authorization_codes table) ─────────────

export const sqlRefreshTokenRepository: RefreshTokenRepository = {
  async insert(tokenHash, record) {
    await db.execute(sql`DELETE FROM oauth_authorization_codes WHERE expires_at <= NOW()`);
    await db.execute(sql`
      INSERT INTO oauth_authorization_codes
        (code_hash, user_id, client_id, redirect_uri, code_challenge, expires_at)
      VALUES (${ROW_KEY_PREFIX + tokenHash}, ${record.userId}, ${record.clientId},
        ${FAMILY_PREFIX + record.familyId},
        ${encodeMeta("active", record.accessFingerprint, record.scope)},
        NOW() + make_interval(days => ${REFRESH_TOKEN_TTL_DAYS}))
    `);
  },

  async find(tokenHash) {
    const result = await db.execute(sql`
      SELECT user_id AS "userId", client_id AS "clientId", redirect_uri AS "family",
        code_challenge AS "meta", (expires_at <= NOW()) AS "expired"
      FROM oauth_authorization_codes
      WHERE code_hash = ${ROW_KEY_PREFIX + tokenHash}
    `);
    const row = result.rows[0];
    if (!row) return null;
    const meta = decodeMeta(String(row.meta));
    const family = String(row.family);
    if (!meta || !family.startsWith(FAMILY_PREFIX)) return null;
    return {
      userId: String(row.userId),
      clientId: String(row.clientId),
      familyId: family.slice(FAMILY_PREFIX.length),
      status: meta.status,
      scope: meta.scope,
      accessFingerprint: meta.fp,
      expired: row.expired === true || row.expired === "t" || row.expired === "true",
    };
  },

  async markUsedIfActive(tokenHash) {
    const result = await db.execute(sql`
      UPDATE oauth_authorization_codes
      SET code_challenge = 'rt1|used|' || substring(code_challenge FROM 12)
      WHERE code_hash = ${ROW_KEY_PREFIX + tokenHash}
        AND code_challenge LIKE 'rt1|active|%'
        AND expires_at > NOW()
      RETURNING code_hash
    `);
    return result.rows.length === 1;
  },

  async revokeFamily(familyId) {
    await db.execute(sql`
      UPDATE oauth_authorization_codes
      SET code_challenge = regexp_replace(code_challenge, '^rt1\\|[a-z]+\\|', 'rt1|revoked|')
      WHERE redirect_uri = ${FAMILY_PREFIX + familyId}
        AND code_hash LIKE 'rt:%'
    `);
  },
};

// ── Policy ────────────────────────────────────────────────────────────────────

export function generateRefreshToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export async function issueRefreshToken(
  repo: RefreshTokenRepository,
  params: { userId: string; clientId: string; scope: string[]; accessToken: string; familyId?: string },
): Promise<string> {
  const token = generateRefreshToken();
  await repo.insert(hashRefreshToken(token), {
    userId: params.userId,
    clientId: params.clientId,
    familyId: params.familyId ?? randomUUID(),
    scope: params.scope,
    accessFingerprint: accessTokenFingerprint(params.accessToken),
  });
  return token;
}

export type RefreshOutcome =
  | { ok: true; userId: string; clientId: string; scope: string[]; accessToken: string; refreshToken: string }
  | { ok: false; error: "invalid_grant" | "invalid_scope"; description: string };

/**
 * Parse a requested scope string. Returns the granted list (the original when
 * omitted), or null when it asks for anything outside the original grant.
 */
export function narrowScope(original: string[], requested: unknown): string[] | null {
  if (requested === undefined || requested === null || requested === "") return original;
  if (typeof requested !== "string") return null;
  const asked = [...new Set(requested.split(/\s+/).filter(Boolean))];
  if (asked.length === 0) return original;
  if (!asked.every((s) => original.includes(s))) return null;
  return asked;
}

export async function rotateRefreshToken(
  repo: RefreshTokenRepository,
  params: {
    refreshToken: string;
    clientId: string;
    requestedScope?: unknown;
    /** Returns the user's current access (MCP) token, or null if none. */
    loadAccessToken: (userId: string) => Promise<string | null>;
  },
): Promise<RefreshOutcome> {
  const invalid = (description: string): RefreshOutcome => ({ ok: false, error: "invalid_grant", description });
  const { refreshToken, clientId } = params;

  if (!refreshToken || refreshToken.length > MAX_TOKEN_LENGTH || !refreshToken.startsWith(TOKEN_PREFIX)) {
    return invalid("Unknown or expired refresh token");
  }
  const tokenHash = hashRefreshToken(refreshToken);
  const record = await repo.find(tokenHash);
  if (!record) return invalid("Unknown or expired refresh token");

  // Client binding: only the client it was issued to may use it.
  if (!clientId || clientId !== record.clientId) {
    return invalid("Refresh token was not issued to this client");
  }

  // Reuse of a rotated or revoked token: assume theft, kill the whole family.
  if (record.status !== "active") {
    await repo.revokeFamily(record.familyId);
    return invalid("Refresh token has already been used");
  }
  if (record.expired) return invalid("Unknown or expired refresh token");

  const scope = narrowScope(record.scope, params.requestedScope);
  if (!scope) {
    return { ok: false, error: "invalid_scope", description: "Requested scope exceeds the original grant" };
  }

  // Bound to the MCP token that was current at sign-in; regenerating it in
  // Settings disconnects existing OAuth connections.
  const accessToken = await params.loadAccessToken(record.userId);
  if (!accessToken || accessTokenFingerprint(accessToken) !== record.accessFingerprint) {
    await repo.revokeFamily(record.familyId);
    return invalid("Authorization is no longer valid; please reconnect");
  }

  // Atomic single use: a concurrent redemption that loses the race is reuse.
  if (!await repo.markUsedIfActive(tokenHash)) {
    await repo.revokeFamily(record.familyId);
    return invalid("Refresh token has already been used");
  }

  const next = await issueRefreshToken(repo, {
    userId: record.userId,
    clientId: record.clientId,
    scope,
    accessToken,
    familyId: record.familyId,
  });
  return { ok: true, userId: record.userId, clientId: record.clientId, scope, accessToken, refreshToken: next };
}
