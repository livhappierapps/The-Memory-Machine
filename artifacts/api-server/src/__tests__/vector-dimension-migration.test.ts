/**
 * Live-DB test for migrateVectorDimension(): uses a scratch table so the real
 * embeddings table is never touched.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { migrateVectorDimension } from "../lib/db-bootstrap";

const TABLE = "vitest_embedding_dim_scratch";
const INDEX = "vitest_embedding_dim_scratch_idx";

async function dim(): Promise<string | null> {
  const r = await db.execute<{ t: string }>(sql`
    SELECT format_type(a.atttypid, a.atttypmod) AS t FROM pg_attribute a
    WHERE a.attrelid = to_regclass(${TABLE}) AND a.attname = 'embedding'
  `);
  return r.rows[0]?.t ?? null;
}

const prevDim = process.env.EMBEDDING_DIM;

beforeAll(async () => {
  await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS vector`));
  await db.execute(sql.raw(`DROP TABLE IF EXISTS ${TABLE}`));
  await db.execute(sql.raw(`CREATE TABLE ${TABLE} (id serial PRIMARY KEY, embedding vector(1536) NOT NULL)`));
});
afterEach(() => {
  if (prevDim === undefined) delete process.env.EMBEDDING_DIM;
  else process.env.EMBEDDING_DIM = prevDim;
});
afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS ${TABLE}`));
});

describe("migrateVectorDimension", () => {
  it("is a no-op when the configured dimension matches", async () => {
    process.env.EMBEDDING_DIM = "1536";
    expect(await migrateVectorDimension(TABLE, INDEX)).toBe("unchanged");
    expect(await dim()).toBe("vector(1536)");
  });

  it("alters an empty table to the configured dimension", async () => {
    process.env.EMBEDDING_DIM = "8";
    expect(await migrateVectorDimension(TABLE, INDEX)).toBe("altered");
    expect(await dim()).toBe("vector(8)");
  });

  it("refuses to alter a non-empty table", async () => {
    process.env.EMBEDDING_DIM = "8";
    await db.execute(sql.raw(`INSERT INTO ${TABLE} (embedding) VALUES ('[1,2,3,4,5,6,7,8]')`));
    process.env.EMBEDDING_DIM = "16";
    expect(await migrateVectorDimension(TABLE, INDEX)).toBe("blocked_nonempty");
    expect(await dim()).toBe("vector(8)");
  });

  it("reports a missing table", async () => {
    expect(await migrateVectorDimension("vitest_no_such_table", INDEX)).toBe("missing");
  });
});
