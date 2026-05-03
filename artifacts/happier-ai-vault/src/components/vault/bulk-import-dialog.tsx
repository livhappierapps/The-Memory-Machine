/**
 * BulkImportDialog
 *
 * Parses Grok export ZIP files entirely in the browser (no file upload).
 * ZIP parsing logic lives in lib/parse-zip.ts.
 * Conversations are saved one-by-one via the existing createThread + importMessages endpoints.
 */
import { useState, useRef, useCallback } from "react";
import JSZip from "jszip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import {
  createThread,
  importMessages,
  getListThreadsQueryKey,
  getGetStatsQueryKey,
} from "@workspace/api-client-react";
import { parseFileJson } from "@/lib/parse-zip";
import { FileArchive, CheckCircle2, AlertCircle, Loader2, Info } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Phase = "idle" | "reading" | "importing" | "done" | "error";

interface ProgressState {
  done: number;
  total: number;
  lastTitle: string;
  statusMsg: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BulkImportDialog({ open, onOpenChange }: BulkImportDialogProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<ProgressState>({
    done: 0,
    total: 0,
    lastTitle: "",
    statusMsg: "",
  });
  const [result, setResult] = useState<{ imported: number; failed: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const queryClient = useQueryClient();

  const resetState = () => {
    cancelledRef.current = false;
    setPhase("idle");
    setProgress({ done: 0, total: 0, lastTitle: "", statusMsg: "" });
    setResult(null);
    setErrorMsg("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = () => {
    cancelledRef.current = true;
    resetState();
    onOpenChange(false);
  };

  const processFile = useCallback(
    async (file: File) => {
      cancelledRef.current = false;
      setPhase("reading");
      setProgress({ done: 0, total: 0, lastTitle: "", statusMsg: "Reading ZIP file…" });
      setResult(null);
      setErrorMsg("");

        // ── 1. Parse file — ZIP or raw JSON ─────────────────────────────────────
      const isJson =
        file.name.toLowerCase().endsWith(".json") ||
        file.type === "application/json";

      const allConversations = [];

      if (isJson) {
        // Direct JSON export (Grok sometimes sends .json instead of .zip)
        setProgress((p) => ({ ...p, statusMsg: "Reading JSON export…" }));
        try {
          const text = await file.text();
          allConversations.push(...parseFileJson(text));
        } catch (err: any) {
          setErrorMsg(`Could not read JSON file: ${err?.message ?? "unknown error"}.`);
          setPhase("error");
          return;
        }
      } else {
        // ZIP archive
        let zip: JSZip;
        try {
          zip = await JSZip.loadAsync(await file.arrayBuffer());
        } catch (err: any) {
          setErrorMsg(
            `Could not open file: ${err?.message ?? "unknown error"}. ` +
              `Expected a .zip archive or .json export from Grok.`,
          );
          setPhase("error");
          return;
        }

        if (cancelledRef.current) return;

        const jsonEntries = Object.entries(zip.files).filter(
          ([, f]) => !f.dir && f.name.toLowerCase().endsWith(".json"),
        );

        if (jsonEntries.length === 0) {
          const allFiles = Object.entries(zip.files)
            .filter(([, f]) => !f.dir)
            .map(([n]) => n)
            .join(", ");
          setErrorMsg(
            `No JSON files found in the ZIP. Files inside: ${allFiles || "none"}. ` +
              `Grok exports should contain .json conversation files.`,
          );
          setPhase("error");
          return;
        }

        setProgress((p) => ({ ...p, statusMsg: `Scanning ${jsonEntries.length} file(s)…` }));

        let diagText = "";
        for (const [name, entry] of jsonEntries) {
          if (cancelledRef.current) return;
          try {
            const text = await entry.async("string");
            // Collect diagnostics from first file for error reporting
            if (!diagText) {
              try {
                const parsed = JSON.parse(text);
                const topKeys = Array.isArray(parsed)
                  ? `Array[${parsed.length}], first item keys: ${Object.keys(parsed[0] ?? {}).join(", ")}`
                  : `Object keys: ${Object.keys(parsed).join(", ")}`;
                diagText = `File: ${name}\nStructure: ${topKeys}\nPreview: ${text.slice(0, 300)}`;
              } catch {
                diagText = `File: ${name}\nCould not parse as JSON`;
              }
            }
            allConversations.push(...parseFileJson(text));
          } catch {
            // skip unreadable files
          }
        }

        if (allConversations.length === 0 && diagText) {
          setErrorMsg(
            `Could not parse conversations — Grok's format may need a parser update.\n\n` +
            `── Debug info (share this with the developer) ──\n${diagText}`,
          );
          setPhase("error");
          return;
        }
      }

      if (cancelledRef.current) return;

      if (allConversations.length === 0) {
        setErrorMsg(`Could not parse any conversations from this file. The format may differ from what's expected.`);
        setPhase("error");
        return;
      }

      // ── 4. Save via API (createThread + importMessages per conversation) ──────
      setPhase("importing");
      setProgress({
        done: 0,
        total: allConversations.length,
        lastTitle: "",
        statusMsg: `Saving ${allConversations.length} conversation${allConversations.length === 1 ? "" : "s"}…`,
      });

      let imported = 0;
      let failed = 0;

      for (const convo of allConversations) {
        if (cancelledRef.current) return;
        try {
          const thread = await createThread({ title: convo.title });
          await importMessages(thread.id, {
            raw: JSON.stringify(convo.messages),
            format: "json",
          });
          imported++;
          setProgress({
            done: imported,
            total: allConversations.length,
            lastTitle: convo.title,
            statusMsg: `Saving conversation ${imported} of ${allConversations.length}…`,
          });
        } catch {
          failed++;
        }
      }

      if (cancelledRef.current) return;

      setResult({ imported, failed });
      setPhase("done");

      queryClient.invalidateQueries({
        queryKey: getListThreadsQueryKey(),
        exact: false,
        refetchType: "all",
      });
      queryClient.invalidateQueries({
        queryKey: getGetStatsQueryKey(),
        exact: false,
        refetchType: "all",
      });
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

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Import Grok Export</DialogTitle>
          <DialogDescription>
            Select your Grok export — a .zip archive or a .json file. Everything is read
            directly in your browser; nothing is uploaded.
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

        {(phase === "reading" || phase === "importing") && (
          <ImportProgress progress={progress} pct={pct} onCancel={handleClose} />
        )}

        {phase === "done" && result && (
          <ImportDone result={result} onImportAnother={resetState} onClose={handleClose} />
        )}

        {phase === "error" && (
          <ImportError errorMsg={errorMsg} onRetry={resetState} onClose={handleClose} />
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
      aria-label="Click or drag a ZIP file here to import"
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
        <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
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

function ImportProgress({
  progress,
  pct,
  onCancel,
}: {
  progress: ProgressState;
  pct: number;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 space-y-5">
      <div className="flex items-center gap-3 text-sm text-muted-foreground min-h-[20px]">
        <Loader2 className="w-4 h-4 animate-spin shrink-0 text-primary" />
        <span className="truncate">{progress.statusMsg || "Working…"}</span>
      </div>

      {progress.total > 0 && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {progress.done} of {progress.total} conversation
              {progress.total === 1 ? "" : "s"}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {progress.lastTitle && (
            <p className="text-xs text-muted-foreground truncate">
              <span className="text-foreground/60">Last saved: </span>
              {progress.lastTitle}
            </p>
          )}
        </div>
      )}

      <Button variant="outline" size="sm" onClick={onCancel} className="w-full">
        Cancel
      </Button>
    </div>
  );
}

function ImportDone({
  result,
  onImportAnother,
  onClose,
}: {
  result: { imported: number; failed: number };
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
          {result.failed > 0 && (
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5 justify-center">
              <Info className="w-3.5 h-3.5" />
              {result.failed} could not be saved and were skipped
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

function ImportError({
  errorMsg,
  onRetry,
  onClose,
}: {
  errorMsg: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const hasDebug = errorMsg.includes("── Debug info");
  const [main, debug] = hasDebug ? errorMsg.split(/── Debug info[^\n]*\n/) : [errorMsg, ""];

  return (
    <div className="mt-2 space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div className="text-sm min-w-0 w-full">
          <p className="font-medium text-destructive">Import failed</p>
          <p className="text-muted-foreground mt-1 break-words">{main.trim()}</p>
          {debug && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-1 font-medium">
                Debug info — tap and hold to copy, then share with developer:
              </p>
              <pre className="text-xs bg-black/30 rounded p-2 overflow-x-auto overflow-y-auto max-h-40 whitespace-pre-wrap break-all select-all border border-border/30 cursor-text">
                {debug.trim()}
              </pre>
            </div>
          )}
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
