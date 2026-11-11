import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";

const { userId } = vi.hoisted(() => ({ userId: `payment-banner-test-${Math.random()}` }));

vi.mock("../middlewares/auth", () => ({
  requireAuth(req: Request, _res: Response, next: NextFunction) {
    req.userId = userId;
    next();
  },
}));

import settingsRouter from "../routes/settings";
import { encryptField, sha256Hex } from "../lib/field-crypto";

const app = express();
app.use(express.json());
app.use(settingsRouter);

beforeAll(async () => {
  const token = randomUUID();
  await db.insert(settingsTable).values({
    userId,
    mcpToken: encryptField(userId, token),
    mcpTokenHash: sha256Hex(token),
  });
});

afterAll(async () => {
  await db.delete(settingsTable).where(eq(settingsTable.userId, userId));
});

describe("settings payment status", () => {
  it("returns active by default", async () => {
    const response = await request(app).get("/settings").expect(200);
    expect(response.body.paymentStatus).toBe("active");
  });

  it("returns overdue after an admin updates the database", async () => {
    await db.update(settingsTable).set({ paymentStatus: "overdue" })
      .where(eq(settingsTable.userId, userId));
    const response = await request(app).get("/settings").expect(200);
    expect(response.body.paymentStatus).toBe("overdue");
  });

  it("does not allow users to clear their payment status through settings", async () => {
    const response = await request(app).put("/settings")
      .send({ defaultModel: "grok-3", paymentStatus: "active" }).expect(200);
    expect(response.body.paymentStatus).toBe("overdue");
  });
});
