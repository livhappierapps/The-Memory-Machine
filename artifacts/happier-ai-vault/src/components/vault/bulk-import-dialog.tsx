import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { getListThreadsQueryKey, getGetStatsQueryKey } from "@workspace/api-client-react";
import { Upload, FileArchive, CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@clerk/react";

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Phase = "idle" | "uploading" | "processing" | "done" | "error";

interface Progress {
  done: number;
  total: number;
  lastTitle: string;
}

export function BulkImportDialog({ open, onOpenChange }: BulkImportDialogProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 0, lastTitle: "" });
  const [result, setResult] = useState<{ imported: number; failed: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { getToken } = useAuth();

  const reset = () => {
    setPhase("idle");
    setStatusMsg("");
    setProgress({ done: 0, total: 0, lastTitle: "" });
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = () => {
    if (phase === "uploading" || phase === "processing") {
      abortRef.current?.abort();
    }
    reset();
    onOpenChange(false);
  };

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".zip")) {
      toast({ title: "Wrong file type", description: "Please select a .zip file.", variant: "destructive" });
      return;
    }

    abortRef.current = new AbortController();
    setPhase("uploading");
    setStatusMsg("Uploading ZIP…");
    setProgress({ done: 0, total: 0, lastTitle: "" });
    setResult(null);

    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/import/zip", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "Unknown error");
        throw new Error(text);
      }

      setPhase("processing");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));

            if (payload.type === "status") {
              setStatusMsg(payload.message);
            } else if (payload.type === "total") {
              setProgress((p) => ({ ...p, total: payload.total }));
              setStatusMsg(`Importing ${payload.total} conversation${payload.total === 1 ? "" : "s"}…`);
            } else if (payload.type === "progress") {
              setProgress({ done: payload.done, total: payload.total, lastTitle: payload.title });
            } else if (payload.type === "done") {
              setResult({ imported: payload.imported, failed: payload.failed });
              setPhase("done");
              queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey(), exact: false, refetchType: "all" });
              queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey(), exact: false, refetchType: "all" });
            } else if (payload.type === "error") {
              setStatusMsg(payload.message);
              setPhase("error");
            }
          } catch {
            // skip malformed SSE
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setStatusMsg(err?.message ?? "Unexpected error occurred.");
      setPhase("error");
    }
  }, [getToken, queryClient, toast]);

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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import Grok ZIP Archive</DialogTitle>
          <DialogDescription>
            Upload the ZIP file you received from Grok. Every conversation will be imported as a separate thread automatically.
          </DialogDescription>
        </DialogHeader>

        {/* ── Idle: drop zone ── */}
        {phase === "idle" && (
          <div
            className={`mt-2 border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-4 transition-colors cursor-pointer
              ${dragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/50 hover:bg-muted/30"}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors
              ${dragOver ? "bg-primary/20" : "bg-muted"}`}>
              <FileArchive className={`w-8 h-8 transition-colors ${dragOver ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div className="text-center">
              <p className="font-medium">Drop your ZIP here</p>
              <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={onFileChange}
            />
          </div>
        )}

        {/* ── Uploading / Processing ── */}
        {(phase === "uploading" || phase === "processing") && (
          <div className="mt-2 space-y-5">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-primary" />
              <span>{statusMsg}</span>
            </div>

            {progress.total > 0 && (
              <>
                {/* Progress bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{progress.done} of {progress.total} conversations</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Current item */}
                {progress.lastTitle && (
                  <p className="text-xs text-muted-foreground truncate">
                    <span className="text-foreground/60">Last imported: </span>
                    {progress.lastTitle}
                  </p>
                )}
              </>
            )}

            <Button variant="outline" size="sm" onClick={handleClose} className="w-full">
              Cancel
            </Button>
          </div>
        )}

        {/* ── Done ── */}
        {phase === "done" && result && (
          <div className="mt-2 space-y-4">
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="w-12 h-12 text-primary" />
              <div className="text-center">
                <p className="text-lg font-semibold">
                  {result.imported} conversation{result.imported === 1 ? "" : "s"} imported
                </p>
                {result.failed > 0 && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {result.failed} could not be parsed and were skipped
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={reset}>
                Import another
              </Button>
              <Button className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {phase === "error" && (
          <div className="mt-2 space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Import failed</p>
                <p className="text-muted-foreground mt-0.5">{statusMsg}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={reset}>
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
