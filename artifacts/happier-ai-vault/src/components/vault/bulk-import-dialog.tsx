/**
 * BulkImportDialog
 *
 * Uploads the user's Grok export (ZIP or JSON) directly to the server.
 * All parsing and DB insertion happens server-side, so there are no
 * browser memory limits — large files and mobile devices work fine.
 *
 * The server responds with an SSE stream of progress events:
 *   { type: "progress", processed, imported, skipped }
 *   { type: "done",     imported, skipped, errors }
 *   { type: "error",    message }
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
import { getListThreadsQueryKey, getGetStatsQueryKey } from "@workspace/api-client-react";
import { FileArchive, CheckCircle2, AlertCircle, Loader2, Info } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Phase = "idle" | "uploading" | "processing" | "done" | "error";

interface ProgressState {
  saved: number;
  statusMsg: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BulkImportDialog({ open, onOpenChange }: BulkImportDialogProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ProgressState>({ saved: 0, statusMsg: "" });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const resetState = () => {
    abortRef.current = null;
    setPhase("idle");
    setProgress({ saved: 0, statusMsg: "" });
    setResult(null);
    setErrorMsg("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = () => {
    abortRef.current?.abort();
    resetState();
    onOpenChange(false);
  };

  const processFile = useCallback(
    async (file: File) => {
      resetState();
      setPhase("uploading");
      setProgress({ saved: 0, statusMsg: "Uploading to server…" });

      const controller = new AbortController();
      abortRef.current = controller;

      const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
      const formData = new FormData();
      formData.append("file", file);

      try {
        const response = await fetch(`${basePath}/api/import/upload`, {
          method: "POST",
          body: formData,
          credentials: "include",
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(body.error ?? `Server error ${response.status}`);
        }

        if (!response.body) throw new Error("No response body from server");

        // Switch to processing phase as soon as the server starts responding
        setPhase("processing");
        setProgress({ saved: 0, statusMsg: "Analysing your conversations…" });

        // Read SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            try {
              const event = JSON.parse(line.slice(6));

              if (event.type === "progress") {
                setProgress({
                  saved: event.imported as number,
                  statusMsg: `Saving conversations… ${event.imported} done`,
                });
              } else if (event.type === "done") {
                const r: ImportResult = {
                  imported: event.imported,
                  skipped: event.skipped,
                  errors: event.errors,
                };
                setResult(r);
                setPhase("done");
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
                throw new Error(event.message as string);
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue; // skip malformed SSE frames
              throw parseErr;
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setErrorMsg(
          err instanceof Error ? err.message : "Something went wrong. Please try again.",
        );
        setPhase("error");
      }
    },
    [queryClient],
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Import Grok Export</DialogTitle>
          <DialogDescription>
            Drop your Grok export — a .zip archive or a .json file. The file is uploaded and
            processed on the server, so any size works on any device.
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

        {(phase === "uploading" || phase === "processing") && (
          <ProcessingView phase={phase} progress={progress} onCancel={handleClose} />
        )}

        {phase === "done" && result && (
          <DoneView result={result} onImportAnother={resetState} onClose={handleClose} />
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
        <p className="text-sm text-muted-foreground mt-1">or click to browse — any size works</p>
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

function ProcessingView({
  phase,
  progress,
  onCancel,
}: {
  phase: "uploading" | "processing";
  progress: ProgressState;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 space-y-5">
      <div className="flex items-center gap-3 text-sm text-muted-foreground min-h-[20px]">
        <Loader2 className="w-4 h-4 animate-spin shrink-0 text-primary" />
        <span className="truncate">{progress.statusMsg || "Working…"}</span>
      </div>

      {phase === "uploading" && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Uploading your file — this may take a moment for large archives.
          </p>
          {/* Indeterminate progress bar while uploading */}
          <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded-full animate-pulse w-1/3" />
          </div>
        </div>
      )}

      {phase === "processing" && progress.saved > 0 && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {progress.saved} conversation{progress.saved === 1 ? "" : "s"} saved
            </span>
          </div>
          {/* Indeterminate bar — total count unknown until parse completes */}
          <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded-full animate-pulse w-2/3" />
          </div>
        </div>
      )}

      <Button variant="outline" size="sm" onClick={onCancel} className="w-full">
        Cancel
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
  return (
    <div className="mt-2 space-y-4">
      <div className="flex flex-col items-center gap-3 py-4">
        <CheckCircle2 className="w-12 h-12 text-primary" />
        <div className="text-center">
          <p className="text-lg font-semibold">
            {result.imported} conversation{result.imported === 1 ? "" : "s"} imported
          </p>
          {(result.skipped > 0 || result.errors > 0) && (
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5 justify-center">
              <Info className="w-3.5 h-3.5 shrink-0" />
              {result.skipped + result.errors} item
              {result.skipped + result.errors === 1 ? " was" : "s were"} skipped or empty
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
