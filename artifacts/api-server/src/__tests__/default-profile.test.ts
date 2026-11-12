/**
 * Live-DB tests for the shared default-profile helper and its use by MCP
 * save_memory, plus MCP search spanning all of a user's profiles.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Response } from "express";
import request from "supertest";

vi.mock("../lib/embeddings.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(null),
  generateEmbeddingResult: vi.fn().mockResolvedValue({ vector: null, permanentFailure: false }),
  storeEmbedding: vi.fn().mockResolvedValue(false),
  embedMessageAsync: vi.fn(),
}));

import { db, messagesTable, profilesTable, settingsTable, threadsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getDefaultProfile, listProfiles, pickProfile } from "../lib/default-profile.js";
import { encryptField, sha256Hex } from "../lib/field-crypto.js";
import mcpRouter from "../routes/mcp.js";

const USER = "test-user-default-profile";
const TOKEN = "default-profile-test-token-vitest-only";
let older: number;
let newer: number;
let secondProfileThread: number;

function mcpApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use(mcpRouter);
  return app;
}

function call(name: string, args: Record<string, unknown>) {
  return request(mcpApp())
    .post("/mcp")
    .set("Authorization", `Bearer ${TOKEN}`)
    .set("Accept", "application/json, text/event-stream")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
}

function text(res: { text: string }): string {
  const line = res.text.split("\n").find((l) => l.startsWith("data: "));
  const json = JSON.parse(line ? line.slice(6) : res.text);
  return json.result?.content?.[0]?.text ?? "";
}

beforeAll(async () => {
  // Insert the *newer* profile first so it gets the LOWER id: ordering must be
  // by created_at, not id.
  const [n] = await db.insert(profilesTable).values({
    userId: USER, name: "Work", emoji: "💼", color: "#111111", createdAt: new Date("2026-02-01T00:00:00Z"),
  }).returning({ id: profilesTable.id });
  const [o] = await db.insert(profilesTable).values({
    userId: USER, name: "Default", emoji: "🤖", color: "#222222", createdAt: new Date("2025-01-01T00:00:00Z"),
  }).returning({ id: profilesTable.id });
  newer = n!.id;
  older = o!.id;
  await db.insert(settingsTable).values({ userId: USER, mcpToken: TOKEN, mcpTokenHash: sha256Hex(TOKEN) })
    .onConflictDoUpdate({ target: settingsTable.userId, set: { mcpToken: TOKEN, mcpTokenHash: sha256Hex(TOKEN) } });
  const [t] = await db.insert(threadsTable).values({
    userId: USER, profileId: newer, title: "Quarterly planning", model: "grok-3",
  }).returning({ id: threadsTable.id });
  secondProfileThread = t!.id;
  await db.insert(messagesTable).values({
    threadId: secondProfileThread, role: "user", content: encryptField(USER, "The okapi launch is in March"),
  });
});

afterAll(async () => {
  const threads = await db.select({ id: threadsTable.id }).from(threadsTable).where(eq(threadsTable.userId, USER));
  for (const t of threads) await db.delete(messagesTable).where(eq(messagesTable.threadId, t.id));
  await db.delete(threadsTable).where(eq(threadsTable.userId, USER));
  await db.delete(profilesTable).where(eq(profilesTable.userId, USER));
  await db.delete(settingsTable).where(eq(settingsTable.userId, USER));
});

describe("default profile helper", () => {
  it("returns the oldest profile, not the lowest id", async () => {
    expect(older).toBeGreaterThan(newer);
    expect((await getDefaultProfile(USER))?.id).toBe(older);
  });

  it("lists profiles default-first", async () => {
    expect((await listProfiles(USER)).map((p) => p.id)).toEqual([older, newer]);
  });

  it("pickProfile honours an owned requested id and falls back to the default", () => {
    const list = [{ id: older }, { id: newer }];
    expect(pickProfile(list, newer)?.id).toBe(newer);
    expect(pickProfile(list, 999_999)?.id).toBe(older);
    expect(pickProfile(list, null)?.id).toBe(older);
    expect(pickProfile([], 1)).toBeNull();
  });

  it("returns null for a user with no profiles", async () => {
    expect(await getDefaultProfile("no-such-user-default-profile")).toBeNull();
  });
});

describe("MCP uses the shared default profile and searches all profiles", () => {
  it("save_memory attaches the new thread to the default (oldest) profile", async () => {
    const res = await call("save_memory", { title: "default-profile-save-check", content: "hello", pin: false });
    expect(res.status).toBe(200);
    const [t] = await db.select({ profileId: threadsTable.profileId }).from(threadsTable)
      .where(and(eq(threadsTable.userId, USER), eq(threadsTable.title, "default-profile-save-check")));
    expect(t?.profileId).toBe(older);
  });

  it("search_memories finds content saved under a non-default profile", async () => {
    const res = await call("search_memories", { query: "okapi" });
    expect(text(res)).toContain(`#${secondProfileThread}`);
  });
});
