import { useAuth } from "@clerk/expo";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { fetch as expoFetch } from "expo/fetch";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { resolveApiOrigin } from "@/utils/api-origin";
import { AppState } from "react-native";
import { ForegroundUpload, UploadHttpError } from "@/utils/foreground-upload";
import { getImportStatus } from "@workspace/api-client-react";

const CHUNK_SIZE = 10 * 1024 * 1024;

function waitForStatusPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export interface PreloadedFile {
  uri: string;
  fileName: string;
  mimeType: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

export type ImportPhase =
  | "idle"
  | "picking"
  | "uploading"
  | "processing"
  | "done"
  | "error"
  | "interrupted";

interface ImportContextValue {
  phase: ImportPhase;
  chunksDone: number;
  totalChunks: number;
  savedCount: number;
  statusMsg: string;
  result: ImportResult | null;
  errorMsg: string | null;
  isUploadPaused: boolean;
  uploadResumed: boolean;
  /** Open the native document picker and start importing. */
  startImportFromPicker: () => Promise<void>;
  /** Start importing a file that was already resolved (e.g. from a share intent). */
  startImportFromFile: (file: PreloadedFile) => void;
  /** Abort an in-flight import. */
  cancelImport: () => void;
  /** Reset state back to idle (call after the result has been consumed). */
  resetImport: () => void;
  /**
   * Reset to idle and immediately open the picker. Safe to call from an event
   * handler even when phase is currently "error" — avoids the stale-closure
   * race that happens when resetImport() + startImportFromPicker() are called
   * back-to-back in the same render cycle.
   */
  retryImport: () => Promise<void>;
}

const ImportContext = createContext<ImportContextValue | null>(null);

export function ImportProvider({ children }: { children: React.ReactNode }) {
  const { getToken, userId } = useAuth();
  const [foreground] = useState(() => new ForegroundUpload(AppState.currentState !== "background" && AppState.currentState !== "inactive"));

  const baseUrl = resolveApiOrigin(process.env["EXPO_PUBLIC_DOMAIN"]);

  const [phase, setPhaseState] = useState<ImportPhase>("idle");
  // phaseRef mirrors state so async callbacks (and retry logic) always see the
  // committed phase without relying on a stale closure.
  const phaseRef = useRef<ImportPhase>("idle");
  const [isUploadPaused, setUploadPaused] = useState(false);
  const [uploadResumed, setUploadResumed] = useState(false);
  const setPhase = useCallback((p: ImportPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
    setUploadPaused(p === "uploading" && !foreground.active);
  }, [foreground]);

  const [chunksDone, setChunksDone] = useState(0);
  const [totalChunks, setTotalChunks] = useState(1);
  const [savedCount, setSavedCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const startedForFileRef = useRef<string | null>(null);
  const processingUploadIdRef = useRef<string | null>(null);
  const statusReconciliationRef = useRef<{
    uploadId: string;
    controller: AbortController;
  } | null>(null);

  const resetImport = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    statusReconciliationRef.current?.controller.abort();
    statusReconciliationRef.current = null;
    processingUploadIdRef.current = null;
    setPhase("idle");
    setChunksDone(0);
    setTotalChunks(1);
    setSavedCount(0);
    setStatusMsg("");
    setResult(null);
    setErrorMsg(null);
    setUploadResumed(false);
    startedForFileRef.current = null;
  }, [setPhase]);

  const cancelImport = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    resetImport();
  }, [resetImport]);

  const reconcileImportStatus = useCallback(async (uploadId: string) => {
    const current = statusReconciliationRef.current;
    if (current?.uploadId === uploadId && !current.controller.signal.aborted) return;
    current?.controller.abort();

    const run = { uploadId, controller: new AbortController() };
    statusReconciliationRef.current = run;
    setErrorMsg(null);
    setStatusMsg("Connection lost. Checking the import result…");
    let delayMs = 1_000;

    try {
      while (
        !run.controller.signal.aborted &&
        foreground.active &&
        processingUploadIdRef.current === uploadId
      ) {
        try {
          const status = await getImportStatus(uploadId, { signal: run.controller.signal });
          if (status.status === "done") {
            processingUploadIdRef.current = null;
            setSavedCount(status.imported);
            setResult({
              imported: status.imported,
              skipped: status.skipped,
              errors: status.errors,
            });
            setStatusMsg("");
            setErrorMsg(null);
            setPhase("done");
            return;
          }
          if (status.status === "error") {
            processingUploadIdRef.current = null;
            setStatusMsg("");
            setErrorMsg(status.message ?? "The import could not be completed.");
            setPhase("error");
            return;
          }
          setStatusMsg("Your conversations are still processing on the server…");
        } catch (err) {
          if (run.controller.signal.aborted) return;
          const httpStatus =
            err && typeof err === "object" && "status" in err
              ? (err as { status?: unknown }).status
              : undefined;
          if (httpStatus === 404) {
            processingUploadIdRef.current = null;
            setStatusMsg("");
            setErrorMsg("No final import result was found. The import may not have started; please try again.");
            setPhase("error");
            return;
          }
          setStatusMsg("Reconnecting to retrieve the import result…");
        }

        await waitForStatusPoll(delayMs, run.controller.signal);
        delayMs = Math.min(delayMs * 2, 8_000);
      }
    } finally {
      if (statusReconciliationRef.current === run) {
        statusReconciliationRef.current = null;
      }
    }
  }, [foreground, setPhase]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      const returning = !foreground.active && active;
      foreground.setActive(active);
      setUploadPaused(phaseRef.current === "uploading" && !active);
      if (returning && phaseRef.current === "uploading") setUploadResumed(true);
      if (!active) {
        statusReconciliationRef.current?.controller.abort();
        statusReconciliationRef.current = null;
      } else if (returning && processingUploadIdRef.current) {
        const uploadId = processingUploadIdRef.current;
        setPhase("processing");
        void reconcileImportStatus(uploadId);
      }
    });
    return () => subscription.remove();
  }, [foreground, reconcileImportStatus, setPhase]);

  // Never resume an old account's upload using the next account's credentials.
  useEffect(() => () => cancelImport(), [userId, cancelImport]);

  const uploadChunk = useCallback(
    async (
      fileUri: string,
      uploadId: string,
      chunkIndex: number,
      chunks: number,
      position: number,
      length: number,
      mimeType: string,
      signal: AbortSignal,
    ) => {
      const base64 = await LegacyFileSystem.readAsStringAsync(fileUri, {
        encoding: "base64",
        position,
        length,
      });
      if (signal.aborted) throw new Error("Upload cancelled");

      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });

      const token = await getToken();
      if (signal.aborted) throw new Error("Upload cancelled");
      if (!token) throw new UploadHttpError("Please sign in again to import.", 401);
      const form = new FormData();
      form.append("uploadId", uploadId);
      form.append("chunkIndex", String(chunkIndex));
      form.append("totalChunks", String(chunks));
      form.append("chunk", blob, "chunk.bin");

      const res = await fetch(`${baseUrl}/api/import/chunk`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        body: form,
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new UploadHttpError(
          `Chunk ${chunkIndex + 1}/${chunks} failed (${res.status}): ${text.slice(0, 120)}`,
          res.status,
        );
      }
    },
    [baseUrl, getToken],
  );

  /**
   * Core upload → finalize → stream pipeline. Shared by both the picker path
   * and the share-intent (preloaded file) path.
   */
  const runImport = useCallback(
    async (fileUri: string, fileName: string, mimeType: string, controller: AbortController) => {
      if (controller.signal.aborted) return;
      const lowerName = fileName.toLowerCase();
      const isZip =
        lowerName.endsWith(".zip") ||
        mimeType === "application/zip" ||
        mimeType === "application/x-zip-compressed";

      const uploadId = Crypto.randomUUID();

      // Materialise content:// URIs (Android share intents) into a file:// path.
      let resolvedUri = fileUri;
      let tempUri: string | null = null;
      if (fileUri.startsWith("content://")) {
        const cacheDir = LegacyFileSystem.cacheDirectory ?? "";
        tempUri = `${cacheDir}import-${uploadId}`;
        setStatusMsg("Preparing file…");
        await LegacyFileSystem.copyAsync({ from: fileUri, to: tempUri });
        resolvedUri = tempUri;
        if (!controller.signal.aborted) setStatusMsg("");
      }

      const cleanupTemp = tempUri
        ? async () => {
            try {
              await LegacyFileSystem.deleteAsync(tempUri!, { idempotent: true });
            } catch {
              // best-effort
            }
          }
        : null;

      try {
        const info = await LegacyFileSystem.getInfoAsync(resolvedUri);
        if (!info.exists) throw new Error("Selected file could not be read.");

        const fileSize = (info as { exists: true; size?: number }).size ?? 0;
        const chunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));

        if (controller.signal.aborted) return;

        setPhase("uploading");
        setTotalChunks(chunks);
        setChunksDone(0);

        for (let i = 0; i < chunks; i++) {
          if (controller.signal.aborted) return;
          const position = i * CHUNK_SIZE;
          const length = Math.min(CHUNK_SIZE, fileSize - position);
          await foreground.run((signal) => uploadChunk(
            resolvedUri,
            uploadId,
            i,
            chunks,
            position,
            length,
            mimeType,
            signal,
          ), controller.signal);
          if (controller.signal.aborted) return;
          setChunksDone(i + 1);
        }

        await foreground.wait(controller.signal);
        if (controller.signal.aborted) return;

        setPhase("processing");
        setSavedCount(0);
        setStatusMsg("Assembling your file…");

        const freshToken = await getToken();
        if (controller.signal.aborted) return;
        if (!freshToken) throw new Error("Please sign in again to import.");
        processingUploadIdRef.current = uploadId;
        const finalizeRes = await expoFetch(`${baseUrl}/api/import/finalize`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${freshToken ?? ""}`,
          },
          body: JSON.stringify({ uploadId, totalChunks: chunks, isZip }),
          signal: controller.signal,
        });

        if (!finalizeRes.ok) {
          const text = await finalizeRes.text().catch(() => "");
          if (finalizeRes.status === 409) {
            void reconcileImportStatus(uploadId);
            return;
          }
          processingUploadIdRef.current = null;
          throw new Error(`Finalize failed (${finalizeRes.status}): ${text.slice(0, 120)}`);
        }

        const reader = finalizeRes.body?.getReader();
        if (!reader) throw new Error("No response body from server");

        const decoder = new TextDecoder();
        let buffer = "";
        let receivedDone = false;

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) return;
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            try {
              const event = JSON.parse(raw) as {
                type: string;
                imported?: number;
                skipped?: number;
                errors?: number;
                message?: string;
              };

              if (event.type === "status") {
                setStatusMsg(event.message ?? "");
              } else if (event.type === "progress") {
                setStatusMsg("");
                setSavedCount(event.imported ?? 0);
              } else if (event.type === "done") {
                receivedDone = true;
                processingUploadIdRef.current = null;
                setResult({
                  imported: event.imported ?? 0,
                  skipped: event.skipped ?? 0,
                  errors: event.errors ?? 0,
                });
                setPhase("done");
                return;
              } else if (event.type === "error") {
                processingUploadIdRef.current = null;
                setStatusMsg("");
                setErrorMsg(event.message ?? "Import failed on server");
                setPhase("error");
                return;
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
          }
        }

        if (controller.signal.aborted) return;

        if (!receivedDone) {
          setStatusMsg("Connection lost. Checking the import result…");
          if (foreground.active) void reconcileImportStatus(uploadId);
        }
      } finally {
        await cleanupTemp?.();
      }
    },
    [baseUrl, getToken, uploadChunk, foreground, reconcileImportStatus, setPhase],
  );

  /** Internal: open the picker and run the import. Does NOT check phase. */
  const _openPickerAndImport = useCallback(async () => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setPhase("picking");

    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/json", "application/octet-stream", "*/*"],
        copyToCacheDirectory: true,
      });

      if (controller.signal.aborted) return;
      if (picked.canceled || !picked.assets || picked.assets.length === 0) {
        setPhase("idle");
        return;
      }

      const asset = picked.assets[0]!;
      await runImport(
        asset.uri,
        asset.name ?? "import",
        asset.mimeType ?? "application/octet-stream",
        controller,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Import failed. Please try again.";
      const uploadId = processingUploadIdRef.current;
      if (uploadId) {
        setStatusMsg("Connection lost. Checking the import result…");
        setErrorMsg(null);
        setPhase("processing");
        if (foreground.active) void reconcileImportStatus(uploadId);
      } else {
        setErrorMsg(msg);
        setPhase("error");
      }
    }
  }, [runImport, foreground, reconcileImportStatus, setPhase]);

  const startImportFromPicker = useCallback(async () => {
    // Use phaseRef (not the stale closure) so this guard is always accurate.
    if (phaseRef.current !== "idle") return;
    await _openPickerAndImport();
  }, [_openPickerAndImport]);

  /**
   * Reset state and immediately open the picker. Unlike calling resetImport()
   * then startImportFromPicker() in sequence, this is safe to call from an
   * event handler because it bypasses the idle-phase guard and uses the ref
   * (not the stale React state) to know the phase is being reset right now.
   */
  const retryImport = useCallback(async () => {
    if (phaseRef.current === "uploading" || phaseRef.current === "processing" || phaseRef.current === "picking") return;
    resetImport();
    await _openPickerAndImport();
  }, [_openPickerAndImport, resetImport]);

  // Guard to avoid running twice for the same file URI (StrictMode / fast-refresh).
  const startImportFromFile = useCallback(
    (file: PreloadedFile) => {
      if (phaseRef.current !== "idle") return;
      if (startedForFileRef.current === file.uri) return;
      startedForFileRef.current = file.uri;

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setPhase("picking");

      void runImport(file.uri, file.fileName, file.mimeType, controller).catch((err) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : "Import failed. Please try again.";
        const uploadId = processingUploadIdRef.current;
        if (uploadId) {
          setStatusMsg("Connection lost. Checking the import result…");
          setErrorMsg(null);
          setPhase("processing");
          if (foreground.active) void reconcileImportStatus(uploadId);
        } else {
          setErrorMsg(msg);
          setPhase("error");
        }
      });
    },
    [runImport, foreground, reconcileImportStatus, setPhase],
  );

  return (
    <ImportContext.Provider
      value={{
        phase,
        chunksDone,
        totalChunks,
        savedCount,
        statusMsg,
        result,
        errorMsg,
        isUploadPaused,
        uploadResumed,
        startImportFromPicker,
        startImportFromFile,
        cancelImport,
        resetImport,
        retryImport,
      }}
    >
      {children}
    </ImportContext.Provider>
  );
}

export function useImport() {
  const ctx = useContext(ImportContext);
  if (!ctx) throw new Error("useImport must be used inside ImportProvider");
  return ctx;
}
