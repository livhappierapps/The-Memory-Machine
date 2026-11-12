import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { getAuth } = vi.hoisted(() => ({
  getAuth: vi.fn(),
}));

vi.mock("@clerk/express", () => ({ getAuth }));

import { requireAuth } from "../middlewares/auth.js";

function buildApp() {
  const app = express();
  app.get("/protected", requireAuth, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("requireAuth", () => {
  beforeEach(() => {
    getAuth.mockReset();
  });

  it("allows a request only when Clerk resolves a user", async () => {
    getAuth.mockReturnValue({ userId: "user_test" });

    const response = await request(buildApp()).get("/protected");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("returns 401 when Clerk has no authenticated user", async () => {
    getAuth.mockReturnValue({ userId: null, sessionClaims: null });

    const response = await request(buildApp()).get("/protected");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 and never reaches the route if Clerk auth lookup throws", async () => {
    getAuth.mockImplementation(() => {
      throw new Error("Clerk auth unavailable");
    });

    const response = await request(buildApp()).get("/protected");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });
});
