import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Publish owns production schema changes. Keep durable OAuth codes in the same
// schema source as the rest of the app, not in startup-time CREATE statements.
export const oauthAuthorizationCodesTable = pgTable(
  "oauth_authorization_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    userId: text("user_id").notNull(),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("oauth_authorization_codes_expiry_idx").on(table.expiresAt),
  ],
);
