/**
 * In-memory rate limiter for sensitive endpoints.
 *
 * Two layers:
 * 1. Per-endpoint per-IP limit: max 5 requests per 15 minutes.
 * 2. IP block list: after 10 auth-check failures per IP in 1 hour, block for 1 hour.
 *
 * Both layers use a simple Map. Sufficient for single-instance deployments.
 * Entries are cleaned lazily on access + a periodic GC every 10 minutes.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 5;
const BLOCK_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const BLOCK_THRESHOLD = 10;

interface WindowEntry {
  count: number;
  resetAt: number;
}

// key: "${endpoint}:${ip}"
const windows = new Map<string, WindowEntry>();

// key: ip
const blocks = new Map<string, number>(); // ip → unblockAt timestamp
const failureCounts = new Map<string, WindowEntry>(); // ip → { count, resetAt }

function getIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return (req as any).ip ?? (req as any).socket?.remoteAddress ?? "unknown";
}

/** Check and increment the per-endpoint rate limit. Returns true if the request is allowed. */
export function checkRateLimit(endpoint: string, ip: string): boolean {
  const key = `${endpoint}:${ip}`;
  const now = Date.now();
  const entry = windows.get(key);

  if (!entry || now > entry.resetAt) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_REQUESTS) return false;

  entry.count++;
  return true;
}

/** Record an auth failure for an IP. Blocks the IP if threshold is exceeded. */
export function recordAuthFailure(ip: string): void {
  const now = Date.now();
  const entry = failureCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    failureCounts.set(ip, { count: 1, resetAt: now + BLOCK_WINDOW_MS });
    return;
  }

  entry.count++;
  if (entry.count >= BLOCK_THRESHOLD) {
    blocks.set(ip, now + BLOCK_WINDOW_MS);
  }
}

/** Returns true if the IP is currently blocked. */
export function isIpBlocked(ip: string): boolean {
  const unblockAt = blocks.get(ip);
  if (!unblockAt) return false;
  if (Date.now() > unblockAt) {
    blocks.delete(ip);
    failureCounts.delete(ip);
    return false;
  }
  return true;
}

/** Express middleware factory for sensitive endpoints. */
export function sensitiveEndpointLimiter(endpoint: string) {
  return (
    req: { ip?: string; socket?: { remoteAddress?: string } },
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    const ip = getIp(req);

    if (isIpBlocked(ip)) {
      res.status(429).json({ error: "Too many requests. Try again later." });
      return;
    }

    if (!checkRateLimit(endpoint, ip)) {
      recordAuthFailure(ip);
      res.status(429).json({ error: "Too many requests. Try again in 15 minutes." });
      return;
    }

    next();
  };
}

/** Periodic cleanup of expired entries — call this on an interval. */
export function cleanupRateLimiter(): void {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (now > entry.resetAt) windows.delete(key);
  }
  for (const [ip, entry] of failureCounts) {
    if (now > entry.resetAt) failureCounts.delete(ip);
  }
  for (const [ip, unblockAt] of blocks) {
    if (now > unblockAt) blocks.delete(ip);
  }
}
