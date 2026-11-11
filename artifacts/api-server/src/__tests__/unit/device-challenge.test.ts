import { afterEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const delivery = vi.hoisted(() => vi.fn());
vi.mock("../../middlewares/auth", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.userId = "device-challenge-unit-fixture";
    next();
  },
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: async () => ({
    primaryEmailAddress: { emailAddress: "device-fixture@example.com" },
  }) } },
}));
vi.mock("resend", () => ({
  Resend: class { emails = { send: delivery }; },
}));

import securityRouter from "../../routes/security";
const app = express();
app.use(express.json());
app.use((_req, _res, next) => { next(); });
app.use(securityRouter);
afterEach(() => { vi.unstubAllEnvs(); delivery.mockReset(); });

describe("device verification never bypasses out-of-band production verification", () => {
  it("fails closed in production without exposing an OTP or a device token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    const response = await request(app).post("/security/devices/challenge").send({});
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: expect.stringContaining("email delivery") });
    expect(response.body.otp).toBeUndefined();
    expect(response.body.deviceToken).toBeUndefined();
  });

  it("allows a local test code only in explicit development mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "");
    const response = await request(app).post("/security/devices/challenge").send({});
    expect(response.status).toBe(200);
    expect(response.body.otp).toMatch(/^\d{6}$/);
    expect(response.body.sent).toBe(false);
  });

  it("does not claim the code was sent when the email service rejects delivery", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "test-only-placeholder");
    delivery.mockResolvedValue({ data: null, error: { message: "Rejected", name: "validation_error" } });
    const response = await request(app).post("/security/devices/challenge").send({});
    expect(response.status).toBe(502);
    expect(response.body.otp).toBeUndefined();
    expect(response.body.sent).toBeUndefined();
  });
});
