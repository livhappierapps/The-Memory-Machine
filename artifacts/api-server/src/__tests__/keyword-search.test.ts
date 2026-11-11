/**
 * Live-DB tests for keyword fallback search (titles + plaintext + enc:v1:
 * message content), soft-delete and per-user isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, threadsTable, messagesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { encryptField } from "../lib/field-crypto.js";
import { escapeLike, excerpt, extractTerms, keywordSearchThreads } from "../lib/keyword-search.js";
import { fuseRankings } from "../routes/mcp.js";

const USER = "test-user-keyword-search";
const OTHER = "test-user-keyword-search-other";
const ids: Record<string, number> = {};

beforeAll(async () => {
  const mk = async (userId: string, title: string, extra: Partial<typeof threadsTable.$inferInsert> = {}) => {
    const [t] = await db.insert(threadsTable).values({ userId, title, model: "grok-3", ...extra }).returning({ id: threadsTable.id });
    return t!.id;
  };
  ids.plain = await mk(USER, "Weekend plans");
  ids.enc = await mk(USER, "Untitled");
  ids.title = await mk(USER, "Butterfly garden ideas");
  ids.deleted = await mk(USER, "Old", { deletedAt: new Date() });
  ids.other = await mk(OTHER, "Someone else");
  ids.dated = await mk(USER, "Dated", { createdAt: new Date("2020-01-15T12:00:00Z") });
  await db.insert(messagesTable).values([
    { threadId: ids.plain, role: "user", content: "We drove to the beach at Montauk and saw dolphins" },
    { threadId: ids.enc, role: "assistant", content: encryptField(USER, "Your sister Maya loves the beach, especially at sunrise") },
    { threadId: ids.deleted, role: "user", content: "beach beach beach" },
    { threadId: ids.other, role: "user", content: encryptField(OTHER, "beach day with Maya") },
    { threadId: ids.dated, role: "user", content: "a 2020 note about the beach" },
    { threadId: ids.plain, role: "user", content: "literal 100% match_here" },
  ]);
});

afterAll(async () => {
  const all = Object.values(ids);
  await db.delete(messagesTable).where(inArray(messagesTable.threadId, all));
  await db.delete(threadsTable).where(eq(threadsTable.userId, USER));
  await db.delete(threadsTable).where(eq(threadsTable.userId, OTHER));
});

describe("keywordSearchThreads", () => {
  it("finds plaintext and encrypted message content, not only titles", async () => {
    const hits = await keywordSearchThreads({ userId: USER, query: "beach" });
    const found = hits.map((h) => h.threadId);
    expect(found).toContain(ids.plain);
    expect(found).toContain(ids.enc);
    const enc = hits.find((h) => h.threadId === ids.enc)!;
    expect(enc.snippet?.text).toContain("Maya loves the beach");
  });

  it("respects soft-delete and per-user isolation", async () => {
    const found = (await keywordSearchThreads({ userId: USER, query: "beach" })).map((h) => h.threadId);
    expect(found).not.toContain(ids.deleted);
    expect(found).not.toContain(ids.other);
  });

  it("matches thread titles", async () => {
    const hits = await keywordSearchThreads({ userId: USER, query: "butterfly" });
    expect(hits[0]).toMatchObject({ threadId: ids.title, titleHit: true });
  });

  it("ranks threads matching more terms first", async () => {
    const hits = await keywordSearchThreads({ userId: USER, query: "beach Maya" });
    expect(hits[0]!.threadId).toBe(ids.enc);
  });

  it("applies the date range and role filter", async () => {
    const dated = await keywordSearchThreads({
      userId: USER, query: "beach", from: new Date("2020-01-01"), to: new Date("2020-12-31"),
    });
    expect(dated.map((h) => h.threadId)).toEqual([ids.dated]);
    const asst = await keywordSearchThreads({ userId: USER, query: "beach", role: "assistant" });
    expect(asst.map((h) => h.threadId)).toEqual([ids.enc]);
  });

  it("treats LIKE wildcards literally", async () => {
    const hits = await keywordSearchThreads({ userId: USER, query: '"100%"' });
    expect(hits.map((h) => h.threadId)).toEqual([ids.plain]);
    // "_" must not act as a single-char wildcard ("literal 100" has a space).
    const none = await keywordSearchThreads({ userId: USER, query: "literal_100" });
    expect(none).toEqual([]);
  });
});

describe("keyword helpers", () => {
  it("extracts terms, keeps quoted phrases, drops stop-words", () => {
    expect(extractTerms('the "beach trip" with Maya')).toEqual(["beach trip", "with", "maya"]);
    expect(extractTerms("the")).toEqual(["the"]);
  });
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("100%_\\")).toBe("100\\%\\_\\\\");
  });
  it("excerpts around the first match", () => {
    const text = "x".repeat(500) + " dolphins " + "y".repeat(500);
    const e = excerpt(text, ["dolphins"]);
    expect(e).toContain("dolphins");
    expect(e.length).toBeLessThan(260);
  });
  it("fuses rankings so items in several lists rise", () => {
    const fused = fuseRankings([[1, 2, 3], [3, 4], [3]]);
    expect(fused[0]!.id).toBe(3);
    expect(fused.map((f) => f.id).sort()).toEqual([1, 2, 3, 4]);
  });
});
