import { Router, type Request, type Response } from "express";
import multer from "multer";
import os from "os";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { createHash } from "crypto";
import { requireAuth } from "../middlewares/auth";
import { decryptField } from "../lib/field-crypto";
import { streamImportFile } from "../lib/import-stream";
import { resolveEmbeddingKey } from "../lib/embedding-config";
import { listProfiles, pickProfile } from "../lib/default-profile";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import { settingsTable, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  beginImportStatus,
  finishImportStatus,
  getImportStatusForOwner,
} from "../lib/import-status-store";

const router = Router();
type ImportTerminalEvent =
  | { type: "done"; imported: number; skipped: number; errors: number }
  | { type: "error"; message: string };

// Validate uploadId is a proper UUID (prevents path traversal)
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getImportPaths(userId: string, uploadId: string) {
  const userScope = createHash("sha256").update(userId).digest("hex");
  const root = path.join(os.tmpdir(), "memory-machine-imports", userScope);
  const normalizedUploadId = uploadId.toLowerCase();
  return {
    chunkDir: path.join(root, normalizedUploadId),
    assembledPath: path.join(root, `${normalizedUploadId}.assembled`),
  };
}

// Each chunk is ≤ 10 MB on the client; 12 MB cap gives a safe margin
const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => {
      cb(null, `vault-chunk-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
});

// ── POST /api/import/chunk ────────────────────────────────────────────────────
// Accepts one piece of a chunked file upload.
// Body (multipart): chunk (blob), uploadId (uuid), chunkIndex (int), totalChunks (int)
// Response: { received: true, chunkIndex: N }

router.post(
  "/import/chunk",
  requireAuth,
  chunkUpload.single("chunk"),
  async (req: Request, res: Response) => {
    const { uploadId, chunkIndex, totalChunks } = req.body as Record<string, string>;

    if (!uploadId || !UUID_RE.test(uploadId)) {
      if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
      res.status(400).json({ error: "Invalid uploadId" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No chunk received" });
      return;
    }

    const idx = Number(chunkIndex);
    const total = Number(totalChunks);

    if (
      !Number.isSafeInteger(idx) ||
      idx < 0 ||
      !Number.isSafeInteger(total) ||
      total < 1 ||
      total > 10_000 ||
      idx >= total
    ) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      res.status(400).json({ error: "Invalid chunk metadata" });
      return;
    }

    if (!req.userId) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { chunkDir } = getImportPaths(req.userId, uploadId);
    await fs.promises.mkdir(chunkDir, { recursive: true, mode: 0o700 });
    const destPath = path.join(chunkDir, `chunk-${String(idx).padStart(8, "0")}`);

    try {
      // rename is atomic if src and dest are on the same filesystem
      await fs.promises.rename(req.file.path, destPath);
    } catch {
      // Fall back to copy+delete when crossing filesystem boundaries
      await fs.promises.copyFile(req.file.path, destPath);
      await fs.promises.unlink(req.file.path).catch((e: unknown) => {
        req.log.warn({ err: e, path: req.file!.path }, "Failed to delete temp chunk after copy");
      });
    }

    res.json({ received: true, chunkIndex: idx });
  },
);

// ── POST /api/import/finalize ─────────────────────────────────────────────────
// Called after all chunks are uploaded. Assembles the file, processes it,
// and streams SSE progress events back to the client.
// Body (JSON): { uploadId: string, totalChunks: number, isZip: boolean }

// ── GET /api/import/:uploadId/status ─────────────────────────────────────────
router.get("/import/:uploadId/status", requireAuth, async (req: Request, res: Response) => {
  const rawUploadId = req.params.uploadId;
  const uploadId = (Array.isArray(rawUploadId) ? rawUploadId[0] : rawUploadId)?.toLowerCase();
  res.setHeader("Cache-Control", "no-store");
  if (!uploadId || !UUID_RE.test(uploadId)) {
    res.status(400).json({ error: "Invalid uploadId" });
    return;
  }
  if (!req.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const record = await getImportStatusForOwner(req.userId, uploadId);
  if (!record) {
    res.status(404).json({ error: "Import not found" });
    return;
  }

  res.json({
    uploadId: record.uploadId,
    status: record.status,
    imported: record.imported,
    skipped: record.skipped,
    errors: record.errors,
    message: record.message,
    updatedAt: record.updatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  });
});

router.post("/import/finalize", requireAuth, async (req: Request, res: Response) => {
  const { uploadId, totalChunks, isZip, profileId: clientProfileId } = req.body as {
    uploadId?: string;
    totalChunks?: number;
    isZip?: boolean;
    profileId?: number | null;
  };

  if (!uploadId || !UUID_RE.test(uploadId)) {
    res.status(400).json({ error: "Invalid uploadId" });
    return;
  }

  const total = Number(totalChunks);
  if (!Number.isSafeInteger(total) || total < 1 || total > 10_000) {
    res.status(400).json({ error: "Invalid totalChunks" });
    return;
  }
  if (!req.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const normalizedUploadId = uploadId.toLowerCase();

  try {
    const started = await beginImportStatus(req.userId, normalizedUploadId);
    if (!started) {
      res.status(409).json({ error: "Finalization already started for this upload" });
      return;
    }
  } catch (err) {
    req.log.error({ err, uploadId: normalizedUploadId }, "Failed to create import status");
    res.status(500).json({ error: "Could not start import finalization" });
    return;
  }

  // ── SSE response ─────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const writeEvent = (data: unknown) => {
    if (!res.destroyed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };
  const terminalEventRef: { current: ImportTerminalEvent | null } = { current: null };
  const sendEvent = (data: unknown) => {
    const event = data as { type?: unknown };
    if (event.type === "done" || event.type === "error") {
      terminalEventRef.current = data as ImportTerminalEvent;
      return;
    }
    writeEvent(data);
  };

  // Heartbeat every 8 s — keeps the iOS connection alive through proxies
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": heartbeat\n\n");
  }, 8_000);
  res.on("close", () => {
    if (!res.writableFinished) {
      req.log.info({ uploadId: normalizedUploadId }, "Import client disconnected; server processing continues");
    }
  });

  // Tell the client immediately so it knows things are happening
  sendEvent({ type: "status", message: "Assembling your file…" });

  const { chunkDir, assembledPath } = getImportPaths(req.userId, normalizedUploadId);

  try {
    await fs.promises.mkdir(path.dirname(assembledPath), { recursive: true, mode: 0o700 });
    // Stream all chunks into one assembled file without loading them all into RAM
    const writeStream = fs.createWriteStream(assembledPath, { flags: "wx", mode: 0o600 });
    for (let i = 0; i < total; i++) {
      const chunkPath = path.join(chunkDir, `chunk-${String(i).padStart(8, "0")}`);
      const readStream = fs.createReadStream(chunkPath);
      await pipeline(readStream, writeStream, { end: false });
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end();
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    sendEvent({ type: "status", message: "Opening archive…" });

    req.log.info(
      { userId: req.userId, uploadId: normalizedUploadId, total, isZip },
      "Chunks assembled, starting import",
    );

    // Resolve the user's API key and target profile for embedding generation
    const userId = req.userId!;
    const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.userId, userId));

    // Fetch all profiles so we can both validate the client-supplied profileId
    // and fall back to the first profile when none is provided.
    const userProfiles = await listProfiles(userId);

    // Use the client-supplied profileId if it belongs to this user; otherwise
    // fall back to the user's default profile (shared helper, ordered).
    const resolvedProfile = pickProfile(userProfiles, clientProfileId);

    const profileId = resolvedProfile?.id ?? null;
    // Provider-aware key (profile → settings → server key).
    const emb = resolveEmbeddingKey(userId, resolvedProfile ?? null, { settingsApiKey: settings?.apiKey ?? null });
    const apiKey = emb?.apiKey;
    const embeddingProvider = emb?.provider ?? "xai";

    await streamImportFile(assembledPath, !!isZip, userId, sendEvent, { profileId, apiKey, embeddingProvider });

    const terminalEvent = terminalEventRef.current;
    if (terminalEvent?.type === "done") {
      await finishImportStatus(userId, normalizedUploadId, {
        status: "done",
        imported: terminalEvent.imported,
        skipped: terminalEvent.skipped,
        errors: terminalEvent.errors,
      });
      writeEvent(terminalEvent);
    } else if (terminalEvent?.type === "error") {
      await finishImportStatus(userId, normalizedUploadId, {
        status: "error",
        imported: 0,
        skipped: 0,
        errors: 0,
        message: terminalEvent.message,
      });
      writeEvent(terminalEvent);
    } else {
      const message = "Import ended without a final result.";
      await finishImportStatus(userId, normalizedUploadId, {
        status: "error",
        imported: 0,
        skipped: 0,
        errors: 0,
        message,
      });
      writeEvent({ type: "error", message });
    }
  } catch (err) {
    req.log.error({ err }, "Import finalize failed");
    const message = "An unexpected error occurred. Please try again.";
    try {
      await finishImportStatus(req.userId, normalizedUploadId, {
        status: "error",
        imported: 0,
        skipped: 0,
        errors: 0,
        message,
      });
    } catch (statusErr) {
      req.log.error({ err: statusErr, uploadId: normalizedUploadId }, "Failed to persist import failure status");
    }
    writeEvent({ type: "error", message });
  } finally {
    clearInterval(heartbeat);
    fs.rm(chunkDir, { recursive: true, force: true }, (err) => {
      if (err) logger.warn({ err, chunkDir }, "Failed to remove chunk directory");
    });
    fs.unlink(assembledPath, (err) => {
      if (err) logger.warn({ err, assembledPath }, "Failed to remove assembled file");
    });
    res.end();
  }
});

export default router;
