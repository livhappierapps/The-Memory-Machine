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

const CHUNK_SIZE = 10 * 1024 * 1024;

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
  const { getToken } = useAuth();

  const baseUrl = resolveApiOrigin(process.env["EXPO_PUBLIC_DOMAIN"]);

  const [phase, setPhaseState] = useState<ImportPhase>("idle");
  // phaseRef mirrors state so async callbacks (and retry logic) always see the
  // committed phase without relying on a stale closure.
  const phaseRef = useRef<ImportPhase>("idle");
  const setPhase = useCallback((p: ImportPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const [chunksDone, setChunksDone] = useState(0);
  const [totalChunks, setTotalChunks] = useState(1);
  const [savedCount, setSavedCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const abortedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const resetImport = useCallback(() => {
    setPhase("idle");
    setChunksDone(0);
    setTotalChunks(1);
    setSavedCount(0);
    setStatusMsg("");
    setResult(null);
    setErrorMsg(null);
  }, [setPhase]);

  const cancelImport = useCallback(() => {
    abortedRef.current = true;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    resetImport();
  }, [resetImport]);

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

      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });

      const token = await getToken();
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
        throw new Error(
          `Chunk ${chunkIndex + 1}/${chunks} failed (${res.status}): ${text.slice(0, 120)}`,
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
        setStatusMsg("");
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

        if (abortedRef.current) return;

        setPhase("uploading");
        setTotalChunks(chunks);
        setChunksDone(0);

        for (let i = 0; i < chunks; i++) {
          if (abortedRef.current) return;
          const position = i * CHUNK_SIZE;
          const length = Math.min(CHUNK_SIZE, fileSize - position);
          await uploadChunk(
            resolvedUri,
            uploadId,
            i,
            chunks,
            position,
            length,
            mimeType,
            controller.signal,
          );
          setChunksDone(i + 1);
        }

        if (abortedRef.current) return;

        setPhase("processing");
        setSavedCount(0);
        setStatusMsg("Assembling your file…");

        const freshToken = await getToken();
        const finalizeRes = await expoFetch(`${baseUrl}/api/import/finalize`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${freshToken ?? ""}`,
          },
          body: JSON.stringify({ uploadId, totalChunks: chunks, isZip }),
        });

        if (!finalizeRes.ok) {
          const text = await finalizeRes.text().catch(() => "");
          throw new Error(`Finalize failed (${finalizeRes.status}): ${text.slice(0, 120)}`);
        }

        const reader = finalizeRes.body?.getReader();
        if (!reader) throw new Error("No response body from server");

        const decoder = new TextDecoder();
        let buffer = "";
        let receivedDone = false;

        while (!abortedRef.current) {
          const { done, value } = await reader.read();
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
                setResult({
                  imported: event.imported ?? 0,
                  skipped: event.skipped ?? 0,
                  errors: event.errors ?? 0,
                });
                setPhase("done");
                return;
              } else if (event.type === "error") {
                throw new Error(event.message ?? "Import failed on server");
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
          }
        }

        if (abortedRef.current) return;

        if (!receivedDone) {
          setPhase("interrupted");
        }
      } finally {
        await cleanupTemp?.();
      }
    },
    [baseUrl, getToken, uploadChunk],
  );

  /** Internal: open the picker and run the import. Does NOT check phase. */
  const _openPickerAndImport = useCallback(async () => {
    abortedRef.current = false;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setPhase("picking");

    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/json", "application/octet-stream", "*/*"],
        copyToCacheDirectory: true,
      });

      if (picked.canceled || !picked.assets || picked.assets.length === 0) {
        if (!abortedRef.current) setPhase("idle");
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
      if (abortedRef.current) return;
      const msg = err instanceof Error ? err.message : "Import failed. Please try again.";
      setErrorMsg(msg);
      setPhase("error");
    }
  }, [runImport, setPhase]);

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
    // Reset synchronously via the ref so _openPickerAndImport sees idle.
    phaseRef.current = "idle";
    setPhaseState("idle");
    setChunksDone(0);
    setTotalChunks(1);
    setSavedCount(0);
    setStatusMsg("");
    setResult(null);
    setErrorMsg(null);
    await _openPickerAndImport();
  }, [_openPickerAndImport]);

  // Guard to avoid running twice for the same file URI (StrictMode / fast-refresh).
  const startedForFileRef = useRef<string | null>(null);

  const startImportFromFile = useCallback(
    (file: PreloadedFile) => {
      if (phaseRef.current !== "idle") return;
      if (startedForFileRef.current === file.uri) return;
      startedForFileRef.current = file.uri;

      abortedRef.current = false;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      void runImport(file.uri, file.fileName, file.mimeType, controller).catch((err) => {
        if (abortedRef.current) return;
        const msg = err instanceof Error ? err.message : "Import failed. Please try again.";
        setErrorMsg(msg);
        setPhase("error");
      });
    },
    [phase, runImport],
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
