import { Router, type Request, type Response } from "express";
import multer from "multer";
import os from "os";
import fs from "fs";
import path from "path";
import { requireAuth } from "../middlewares/auth";
import { streamImportFile } from "../lib/import-stream";

const router = Router();

// Store uploads in the OS temp directory so they survive the request but
// get cleaned up by the OS on restart. We delete them immediately after
// processing regardless.
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => {
      const rand = Math.random().toString(36).slice(2, 10);
      cb(null, `vault-import-${Date.now()}-${rand}`);
    },
  }),
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2 GB hard cap
    files: 1,
  },
});

router.post(
  "/import/upload",
  requireAuth,
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file received. Please select a ZIP or JSON file." });
      return;
    }

    const userId = req.userId!;
    const filePath = req.file.path;
    const originalName = req.file.originalname.toLowerCase();
    const isZip =
      originalName.endsWith(".zip") ||
      req.file.mimetype === "application/zip" ||
      req.file.mimetype === "application/x-zip-compressed" ||
      req.file.mimetype === "application/octet-stream"; // iOS sometimes sends this for ZIPs

    // ── SSE response ───────────────────────────────────────────────────────
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (data: unknown) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    // Send a heartbeat every 20 s to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": heartbeat\n\n");
    }, 20_000);

    try {
      req.log.info(
        { userId, size: req.file.size, isZip, name: req.file.originalname },
        "Import upload received",
      );
      await streamImportFile(filePath, isZip, userId, sendEvent);
    } catch (err) {
      req.log.error({ err }, "Import stream failed");
      sendEvent({ type: "error", message: "An unexpected error occurred. Please try again." });
    } finally {
      clearInterval(heartbeat);
      // Delete the temp file regardless of outcome
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) req.log.warn({ err: unlinkErr }, "Failed to delete import temp file");
      });
      res.end();
    }
  },
);

export default router;
