import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
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

const app: Express = express();

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

app.use(cors({ credentials: true, origin: true }));
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

// Purge threads soft-deleted 30+ days ago — runs at startup then every 6 hours
purgeExpiredSoftDeletes();
setInterval(purgeExpiredSoftDeletes, 6 * 60 * 60 * 1000);

// Send queued deletion link emails once executeAfter has elapsed — runs every 5 minutes
sendReadyDeletionLinkEmails();
setInterval(sendReadyDeletionLinkEmails, 5 * 60 * 1000);

export default app;
