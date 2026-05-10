/**
 * BulkImportDialog
 *
 * Sends the user's Grok export to the server in 10 MB chunks so no single
 * HTTP request is large enough to be killed by the reverse proxy or a mobile
 * network timeout.  All parsing and DB insertion happen server-side; the
 * browser only reads the file in small slices and sends them one at a time.
 *
 * Phases:
 *   idle      → drop-zone shown
 *   uploading → progress bar: chunk X of Y uploaded
 *   processing → live counter: X conversations saved so far (SSE stream)
 *   done      → success summary
 *   error     → error message with retry
 */
import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { getListThreadsQueryKey, getGetStatsQueryKey } from "@workspace/api-client-react";
import { FileArchive, CheckCircle2, AlertCircle, Loader2, Info, WifiOff } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per chunk

// ── Types ─────────────────────────────────────────────────────────────────────

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Phase = "idle" | "uploading" | "processing" | "done" | "error" | "interrupted";

interface UploadProgress {
  chunk: number; // chunks sent so far
  total: number; // total chunks
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BulkImportDialog({ open, onOpenChange }: BulkImportDialogProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({ chunk: 0, total: 1 });
  const [savedCount, setSavedCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState(""); // server status during assembly
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // phaseRef must stay in sync with phase so the 400 ms setTimeout in
  // handleOpenChange always sees the latest value — even before React has
  // re-rendered.  We update it synchronously here instead of via useEffect
  // so there is no window where the ref lags behind the state.
  const phaseRef = useRef<Phase>("idle");
  const setPhaseSync = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  const resetState = () => {
    abortRef.current = null;
    setPhaseSync("idle");
    setUploadProgress({ chunk: 0, total: 1 });
    setSavedCount(0);
    setStatusMsg("");
    setResult(null);
    setErrorMsg("");
    if (fileRef.current) fileRef.current.value = "";
  };

  // Guard dialog close events that come from the system (backdrop tap, Escape,
  // or — critically on Android/iOS — the file-picker sheet dismissing).
  //
  // Problem: on Android/Samsung, when the user picks a file the OS fires
  // onOpenChange(false) BEFORE the input's onChange fires. At that instant
  // phase is still "idle", so a naive phase check lets the close through and
  // the dialog snaps shut before the upload even starts.
  //
  // Fix: when idle, delay 400 ms and re-check the phase via a ref. By then
  // processFile has already run and changed phase to "uploading" → we swallow
  // the close. If the user really did dismiss without picking a file the phase
  // is still "idle" after the delay → we close normally.
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) { onOpenChange(true); return; }

    // Never close mid-upload or mid-processing
    if (phase === "uploading" || phase === "processing") return;

    if (phase === "idle") {
      // Delay to let the file onChange fire first
      setTimeout(() => {
        if (phaseRef.current === "idle") {
          abortRef.current?.abort();
          resetState();
          onOpenChange(false);
        }
        // else: a file was picked and upload started — keep dialog open
      }, 400);
      return;
    }

    // done / error / interrupted — allow close immediately
    abortRef.current?.abort();
    resetState();
    onOpenChange(false);
  };

  const handleClose = () => {
    abortRef.current?.abort();
    resetState();
    onOpenChange(false);
  };

  const processFile = useCallback(
    async (file: File) => {
      resetState();

      const controller = new AbortController();
      abortRef.current = controller;

      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      const isZip =
        file.name.toLowerCase().endsWith(".zip") ||
        file.type === "application/zip" ||
        file.type === "application/x-zip-compressed" ||
        file.type === "application/octet-stream"; // iOS sends this for ZIPs

      const uploadId = crypto.randomUUID();
      const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

      // Helper: get a fresh Clerk JWT right before each request so a long
      // upload on a slow connection never hits a 401 from an expired token.
      const authHeader = async (): Promise<Record<string, string>> => {
        const token = await getToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      };

      setPhaseSync("uploading");
      setUploadProgress({ chunk: 0, total: totalChunks });

      try {
        // ── 1. Upload file in 10 MB chunks ──────────────────────────────────
        for (let i = 0; i < totalChunks; i++) {
          if (controller.signal.aborted) return;

          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunkBlob = file.slice(start, end);

          const fd = new FormData();
          fd.append("chunk", chunkBlob, "chunk");
          fd.append("uploadId", uploadId);
          fd.append("chunkIndex", String(i));
          fd.append("totalChunks", String(totalChunks));

          // Fetch a fresh token every chunk — slow connections outlast cookie TTL
          const resp = await fetch(`${basePath}/api/import/chunk`, {
            method: "POST",
            body: fd,
            credentials: "include",
            headers: await authHeader(),
            signal: controller.signal,
          });

          if (!resp.ok) {
            const body = await resp.json().catch(() => ({ error: "Chunk upload failed" }));
            throw new Error((body as { error?: string }).error ?? `Upload error ${resp.status}`);
          }

          setUploadProgress({ chunk: i + 1, total: totalChunks });
        }

        // ── 2. Trigger server-side processing (SSE response) ────────────────
        setPhaseSync("processing");
        setSavedCount(0);

        const processResp = await fetch(`${basePath}/api/import/finalize`, {
          method: "POST",
          body: JSON.stringify({ uploadId, totalChunks, isZip }),
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          credentials: "include",
          signal: controller.signal,
        });

        if (!processResp.ok) {
          const body = await processResp.json().catch(() => ({ error: "Processing failed" }));
          throw new Error((body as { error?: string }).error ?? `Server error ${processResp.status}`);
        }

        if (!processResp.body) throw new Error("No response stream from server");

        // ── 3. Read SSE progress stream ─────────────────────────────────────
        const reader = processResp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let receivedDone = false;

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            try {
              const event = JSON.parse(line.slice(6)) as {
                type: string;
                imported?: number;
                skipped?: number;
                errors?: number;
                message?: string;
              };

              if (event.type === "status") {
                // Server status message during assembly / archive opening
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
                setPhaseSync("done");
                queryClient.invalidateQueries({
                  queryKey: getListThreadsQueryKey(),
                  exact: false,
                  refetchType: "all",
                });
                queryClient.invalidateQueries({
                  queryKey: getGetStatsQueryKey(),
                  refetchType: "all",
                });
                break outer;
              } else if (event.type === "error") {
                throw new Error(event.message ?? "Import failed");
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue; // skip malformed frames
              throw parseErr;
            }
          }
        }

        // Stream ended without a "done" event — the connection was probably
        // dropped by the network (phone screen off, iOS backgrounded the tab).
        // The server may have finished anyway, so refresh the list and let
        // the user check rather than showing a scary error.
        if (!receivedDone) {
          queryClient.invalidateQueries({
            queryKey: getListThreadsQueryKey(),
            exact: false,
            refetchType: "all",
          });
          queryClient.invalidateQueries({
            queryKey: getGetStatsQueryKey(),
            refetchType: "all",
          });
          setPhaseSync("interrupted");
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setErrorMsg(
          err instanceof Error ? err.message : "Something went wrong. Please try again.",
        );
        setPhaseSync("error");
      }
    },
    [queryClient, getToken],
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const uploadPct =
    uploadProgress.total > 0
      ? Math.round((uploadProgress.chunk / uploadProgress.total) * 100)
      : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Import Grok Export</DialogTitle>
          <DialogDescription>
            Drop your Grok export — a .zip archive or a .json file. Any size works on any
            device.
          </DialogDescription>
        </DialogHeader>

        {phase === "idle" && (
          <DropZone
            dragOver={dragOver}
            fileRef={fileRef}
            onFileChange={onFileChange}
            onDrop={onDrop}
            onDragOver={() => setDragOver(true)}
            onDragLeave={() => setDragOver(false)}
          />
        )}

        {phase === "uploading" && (
          <UploadingView
            chunk={uploadProgress.chunk}
            total={uploadProgress.total}
            pct={uploadPct}
            onCancel={handleClose}
          />
        )}

        {phase === "processing" && (
          <ProcessingView savedCount={savedCount} statusMsg={statusMsg} onCancel={handleClose} />
        )}

        {phase === "done" && result && (
          <DoneView result={result} onImportAnother={resetState} onClose={handleClose} />
        )}

        {phase === "interrupted" && (
          <InterruptedView onClose={handleClose} />
        )}

        {phase === "error" && (
          <ErrorView errorMsg={errorMsg} onRetry={resetState} onClose={handleClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DropZone({
  dragOver,
  fileRef,
  onFileChange,
  onDrop,
  onDragOver,
  onDragLeave,
}: {
  dragOver: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
}) {
  return (
    <div
      className={[
        "mt-2 border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-4 transition-colors cursor-pointer select-none",
        dragOver
          ? "border-primary bg-primary/5"
          : "border-border/60 hover:border-primary/50 hover:bg-muted/30",
      ].join(" ")}
      role="button"
      tabIndex={0}
      aria-label="Click or drag a file here to import"
      onClick={() => fileRef.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={[
          "w-16 h-16 rounded-full flex items-center justify-center transition-colors",
          dragOver ? "bg-primary/20" : "bg-muted",
        ].join(" ")}
      >
        <FileArchive
          className={[
            "w-8 h-8 transition-colors",
            dragOver ? "text-primary" : "text-muted-foreground",
          ].join(" ")}
        />
      </div>
      <div className="text-center">
        <p className="font-medium">Drop your ZIP or JSON here</p>
        <p className="text-sm text-muted-foreground mt-1">or tap to browse — any size works</p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="*/*"
        className="hidden"
        onChange={onFileChange}
      />
    </div>
  );
}

function UploadingView({
  chunk,
  total,
  pct,
  onCancel,
}: {
  chunk: number;
  total: number;
  pct: number;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 space-y-5">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin shrink-0 text-primary" />
        <span>
          Uploading…{" "}
          {total > 1 ? `part ${chunk} of ${total}` : "almost there"}
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{pct}% uploaded</span>
          {total > 1 && (
            <span>
              {chunk} / {total} parts
            </span>
          )}
        </div>
        <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${Math.max(4, pct)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Safe to keep your screen on — the upload will resume if interrupted.
        </p>
      </div>

      <Button variant="outline" size="sm" onClick={onCancel} className="w-full">
        Cancel
      </Button>
    </div>
  );
}

function ProcessingView({
  savedCount,
  statusMsg,
  onCancel,
}: {
  savedCount: number;
  statusMsg: string;
  onCancel: () => void;
}) {
  const label = statusMsg
    ? statusMsg
    : savedCount > 0
      ? `Saving conversations… ${savedCount} done so far`
      : "Analysing your conversations…";

  return (
    <div className="mt-2 space-y-5">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin shrink-0 text-primary" />
        <span>{label}</span>
      </div>

      <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary rounded-full animate-pulse w-full opacity-40" />
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Keep this screen open — processing large files can take a few minutes.
      </p>

      <Button variant="outline" size="sm" onClick={onCancel} className="w-full">
        Cancel
      </Button>
    </div>
  );
}

function InterruptedView({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-2 space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <WifiOff className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-amber-500">Connection was interrupted</p>
          <p className="text-muted-foreground mt-1">
            Your file uploaded successfully. The server may have finished saving your
            conversations — check your conversation list now. If nothing appears, try
            importing again.
          </p>
        </div>
      </div>
      <Button
        className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
        onClick={onClose}
      >
        Check my conversations
      </Button>
    </div>
  );
}

function DoneView({
  result,
  onImportAnother,
  onClose,
}: {
  result: ImportResult;
  onImportAnother: () => void;
  onClose: () => void;
}) {
  const skipped = result.skipped + result.errors;
  return (
    <div className="mt-2 space-y-4">
      <div className="flex flex-col items-center gap-3 py-4">
        <CheckCircle2 className="w-12 h-12 text-primary" />
        <div className="text-center">
          <p className="text-lg font-semibold">
            {result.imported} conversation{result.imported === 1 ? "" : "s"} imported
          </p>
          {skipped > 0 && (
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5 justify-center">
              <Info className="w-3.5 h-3.5 shrink-0" />
              {skipped} empty or unreadable {skipped === 1 ? "item was" : "items were"} skipped
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onImportAnother}>
          Import another
        </Button>
        <Button
          className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={onClose}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

function ErrorView({
  errorMsg,
  onRetry,
  onClose,
}: {
  errorMsg: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-2 space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div className="text-sm min-w-0 w-full">
          <p className="font-medium text-destructive">Import failed</p>
          <p className="text-muted-foreground mt-1 break-words">{errorMsg}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onRetry}>
          Try again
        </Button>
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
