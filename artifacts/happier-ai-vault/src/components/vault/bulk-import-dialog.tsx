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
import {
  getListThreadsQueryKey,
  getGetStatsQueryKey,
} from "@workspace/api-client-react";
import {
  Upload,
  FileArchive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Info,
} from "lucide-react";
import { useAuth } from "@clerk/react";

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Phase = "idle" | "uploading" | "processing" | "done" | "error";

interface ProgressState {
  done: number;
  total: number;
  lastTitle: string;
  statusMsg: string;
}

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
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  const resetState = () => {
    setPhase("idle");
    setProgress({ done: 0, total: 0, lastTitle: "", statusMsg: "" });
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
      // Client-side guard — but we won't block on MIME since browsers vary
      if (!file.name.toLowerCase().endsWith(".zip") && file.size === 0) {
        setErrorMsg("The file appears to be empty.");
        setPhase("error");
        return;
      }

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setPhase("uploading");
      setProgress({ done: 0, total: 0, lastTitle: "", statusMsg: "Uploading ZIP to server…" });
      setResult(null);
      setErrorMsg("");

      // ── Get auth token ───────────────────────────────────────────────────────
      let token: string | null = null;
      try {
        token = await getToken();
      } catch (tokenErr) {
        setErrorMsg(`Auth error: ${(tokenErr as Error)?.message ?? "Could not get session token. Try signing out and back in."}`);
        setPhase("error");
        return;
      }

      if (!token) {
        setErrorMsg("No auth session found. Please sign out and sign back in, then try again.");
        setPhase("error");
        return;
      }

      // ── Upload ───────────────────────────────────────────────────────────────
      const formData = new FormData();
      formData.append("file", file);

      let res: Response;
      try {
        res = await fetch("/api/import/zip", {
          method: "POST",
          // Do NOT set Content-Type — browser must set it with the boundary
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
          signal: abortRef.current.signal,
        });
      } catch (fetchErr: any) {
        if (fetchErr?.name === "AbortError") return;
        setErrorMsg(`Network error: ${fetchErr?.message ?? "Could not reach the server."}`);
        setPhase("error");
        return;
      }

      // ── Handle non-OK before streaming ───────────────────────────────────────
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.text();
          detail = body || detail;
        } catch {}
        setErrorMsg(`Server rejected the upload: ${detail}`);
        setPhase("error");
        return;
      }

      if (!res.body) {
        setErrorMsg("Server returned an empty response.");
        setPhase("error");
        return;
      }

      // ── Read SSE stream ──────────────────────────────────────────────────────
      setPhase("processing");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          // SSE events are separated by \n\n
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            for (const line of part.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              let payload: any;
              try {
                payload = JSON.parse(line.slice(6));
              } catch {
                continue;
              }

              switch (payload.type) {
                case "status":
                  setProgress((p) => ({ ...p, statusMsg: payload.message }));
                  break;
                case "total":
                  setProgress((p) => ({
                    ...p,
                    total: payload.total,
                    statusMsg: `Importing ${payload.total} conversation${payload.total === 1 ? "" : "s"}…`,
                  }));
                  break;
                case "progress":
                  setProgress({
                    done: payload.done,
                    total: payload.total,
                    lastTitle: payload.title ?? "",
                    statusMsg: `Importing conversation ${payload.done} of ${payload.total}…`,
                  });
                  break;
                case "done":
                  setResult({ imported: payload.imported, failed: payload.failed });
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
                  break;
                case "error":
                  setErrorMsg(payload.message ?? "Unknown server error.");
                  setPhase("error");
                  break;
              }
            }
          }
        }
      } catch (streamErr: any) {
        if (streamErr?.name === "AbortError") return;
        setErrorMsg(`Stream error: ${streamErr?.message ?? "Connection lost while reading response."}`);
        setPhase("error");
      }

      // If stream ended without a done/error event
      setPhase((current) => {
        if (current === "processing") {
          setErrorMsg("Server closed the connection without a final status.");
          return "error";
        }
        return current;
      });
    },
    [getToken, queryClient],
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

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Import Grok ZIP Archive</DialogTitle>
          <DialogDescription>
            Upload the ZIP file you received from Grok. Every conversation will
            be saved as a separate thread automatically.
          </DialogDescription>
        </DialogHeader>

        {/* ── Idle: drop zone ─────────────────────────────────────────────── */}
        {phase === "idle" && (
          <div
            className={[
              "mt-2 border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-4 transition-colors cursor-pointer select-none",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border/60 hover:border-primary/50 hover:bg-muted/30",
            ].join(" ")}
            role="button"
            tabIndex={0}
            aria-label="Click or drag a ZIP file here"
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
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
              <p className="font-medium">Drop your ZIP here</p>
              <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed,application/octet-stream"
              className="hidden"
              onChange={onFileChange}
            />
          </div>
        )}

        {/* ── Uploading / Processing ──────────────────────────────────────── */}
        {(phase === "uploading" || phase === "processing") && (
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
                    <span className="text-foreground/60">Last: </span>
                    {progress.lastTitle}
                  </p>
                )}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        )}

        {/* ── Done ────────────────────────────────────────────────────────── */}
        {phase === "done" && result && (
          <div className="mt-2 space-y-4">
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="w-12 h-12 text-primary" />
              <div className="text-center">
                <p className="text-lg font-semibold">
                  {result.imported} conversation
                  {result.imported === 1 ? "" : "s"} imported
                </p>
                {result.failed > 0 && (
                  <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5 justify-center">
                    <Info className="w-3.5 h-3.5" />
                    {result.failed} could not be parsed and were skipped
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={resetState}>
                Import another
              </Button>
              <Button
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleClose}
              >
                Done
              </Button>
            </div>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────────────── */}
        {phase === "error" && (
          <div className="mt-2 space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm min-w-0">
                <p className="font-medium text-destructive">Import failed</p>
                <p className="text-muted-foreground mt-1 break-words">{errorMsg}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={resetState}>
                Try again
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
