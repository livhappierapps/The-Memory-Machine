import { Router, type Request, type Response } from "express";
import multer from "multer";
import os from "os";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { requireAuth } from "../middlewares/auth";
import { streamImportFile } from "../lib/import-stream";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import { settingsTable, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// Validate uploadId is a proper UUID (prevents path traversal)
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      res.status(400).json({ error: "Invalid uploadId" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No chunk received" });
      return;
    }

    const idx = Number(chunkIndex);
    const total = Number(totalChunks);

    if (!Number.isFinite(idx) || idx < 0 || !Number.isFinite(total) || total < 1) {
      res.status(400).json({ error: "Invalid chunk metadata" });
      return;
    }

    const chunkDir = path.join(os.tmpdir(), `vault-chunks-${uploadId}`);
    await fs.promises.mkdir(chunkDir, { recursive: true });
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

router.post("/import/finalize", requireAuth, async (req: Request, res: Response) => {
  const { uploadId, totalChunks, isZip } = req.body as {
    uploadId?: string;
    totalChunks?: number;
    isZip?: boolean;
  };

  if (!uploadId || !UUID_RE.test(uploadId)) {
    res.status(400).json({ error: "Invalid uploadId" });
    return;
  }

  const total = Number(totalChunks);
  if (!Number.isFinite(total) || total < 1 || total > 10_000) {
    res.status(400).json({ error: "Invalid totalChunks" });
    return;
  }

  // ── SSE response ─────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (data: unknown) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Heartbeat every 8 s — keeps the iOS connection alive through proxies
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 8_000);

  // Tell the client immediately so it knows things are happening
  sendEvent({ type: "status", message: "Assembling your file…" });

  const chunkDir = path.join(os.tmpdir(), `vault-chunks-${uploadId}`);
  const assembledPath = path.join(os.tmpdir(), `vault-assembled-${uploadId}`);

  try {
    // Stream all chunks into one assembled file without loading them all into RAM
    const writeStream = fs.createWriteStream(assembledPath);
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
      { userId: req.userId, uploadId, total, isZip },
      "Chunks assembled, starting import",
    );

    // Resolve the user's API key and default profile for embedding generation
    const userId = req.userId!;
    const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.userId, userId));
    const [firstProfile] = await db
      .select({ id: profilesTable.id, apiKey: profilesTable.apiKey, embeddingProvider: profilesTable.embeddingProvider })
      .from(profilesTable)
      .where(eq(profilesTable.userId, userId))
      .limit(1);
    const apiKey = firstProfile?.apiKey || settings?.apiKey || undefined;
    const profileId = firstProfile?.id ?? null;
    const embeddingProvider = firstProfile?.embeddingProvider ?? "xai";

    await streamImportFile(assembledPath, !!isZip, userId, sendEvent, { profileId, apiKey, embeddingProvider });
  } catch (err) {
    req.log.error({ err }, "Import finalize failed");
    sendEvent({ type: "error", message: "An unexpected error occurred. Please try again." });
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
