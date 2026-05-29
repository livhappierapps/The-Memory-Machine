import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import helmet from "helmet";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { purgeExpiredSoftDeletes, sendReadyDeletionLinkEmails } from "./routes/deletion-requests";
import { cleanupRateLimiter } from "./lib/rate-limiter";
import { purgeExpiredSnapshots, runWeeklySnapshots } from "./lib/snapshot";
import { deviceTrustMiddleware } from "./middlewares/device-trust";

const app: Express = express();

// Security headers (CSP disabled — Clerk's FAPI JS needs inline scripts)
app.use(helmet({ contentSecurityPolicy: false }));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// CORS — explicit allowlist of Replit-hosted origins only
const replitDomains: string[] = (process.env.REPLIT_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => `https://${d}`);
const devDomain = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null;
const allowedOrigins = new Set<string>([
  ...replitDomains,
  ...(devDomain ? [devDomain] : []),
  "http://localhost",
  "http://localhost:80",
  "http://localhost:5173",
]);
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // Allow same-origin / no-origin requests and the explicit allowlist only
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin not allowed: ${origin}`));
      }
    },
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Device trust — resolves mm_device cookie / X-Device-Token header after Clerk sets req.userId
app.use("/api", deviceTrustMiddleware);

// Disable HTTP caching for all API responses so clients always get fresh data
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  next();
});

app.use("/api", router);

// Global error handler — catches anything that escapes a route's try/catch,
// e.g. errors thrown in middleware or body-parser failures.
// Must have 4 parameters so Express recognises it as an error handler.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled server error");
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Reject startup if SESSION_SECRET is missing or insecure in non-development environments.
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === "dev-secret-change-me") {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET must be set to a strong random value in production. " +
      "Deletion OTPs and signed tokens cannot be trusted otherwise.",
    );
  } else {
    logger.warn(
      "SESSION_SECRET is not set or uses the insecure default. " +
      "OTPs and signed tokens will be predictable. Set SESSION_SECRET before deploying.",
    );
  }
}

// ── Background crons ───────────────────────────────────────────────────────────

// Purge threads soft-deleted 30+ days ago — runs at startup then every 6 hours
purgeExpiredSoftDeletes();
setInterval(purgeExpiredSoftDeletes, 6 * 60 * 60 * 1000);

// Send queued deletion link emails once executeAfter has elapsed — runs every 5 minutes
sendReadyDeletionLinkEmails();
setInterval(sendReadyDeletionLinkEmails, 5 * 60 * 1000);

// Purge expired snapshots — runs once at startup then every 6 hours
purgeExpiredSnapshots();
setInterval(purgeExpiredSnapshots, 6 * 60 * 60 * 1000);

// Weekly automatic snapshots — runs every 7 days
// Also check every hour so the weekly trigger fires accurately across restarts
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
let lastWeeklySnapshot = 0;
setInterval(async () => {
  if (Date.now() - lastWeeklySnapshot >= WEEK_MS) {
    lastWeeklySnapshot = Date.now();
    await runWeeklySnapshots();
  }
}, 60 * 60 * 1000);

// Cleanup in-memory rate limiter entries every 10 minutes
setInterval(cleanupRateLimiter, 10 * 60 * 1000);

export default app;
