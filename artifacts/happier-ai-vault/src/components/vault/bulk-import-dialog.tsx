/**
 * BulkImportDialog — parses Grok ZIP files entirely in the browser.
 *
 * Why client-side parsing?
 *   Uploading a large ZIP through the Replit reverse-proxy triggers the proxy's
 *   ~5-minute request timeout before multer can finish receiving the file.
 *   By reading the ZIP with JSZip in the browser we never send a large payload
 *   over the wire; only small JSON conversation objects are POSTed per-thread.
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
import { FileArchive, CheckCircle2, AlertCircle, Loader2, Info } from "lucide-react";

// ─── Conversation parsing (runs in browser) ───────────────────────────────────

interface ParsedMessage {
  role: "user" | "assistant";
  content: string;
}

interface ParsedConversation {
  title: string;
  messages: ParsedMessage[];
}

function extractText(val: unknown): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val)) {
    return val
      .map((p) =>
        typeof p === "string"
          ? p
          : (p as any)?.text ?? (p as any)?.content ?? (p as any)?.value ?? "",
      )
      .join("");
  }
  if (val && typeof val === "object") {
    const v = val as any;
    if (Array.isArray(v.parts)) return v.parts.map(extractText).join("");
    return v.text ?? v.value ?? v.content ?? "";
  }
  return String(val ?? "");
}

function toRole(r: unknown): "user" | "assistant" | null {
  if (typeof r !== "string") return null;
  const s = r.toLowerCase().trim();
  if (s === "user" || s === "human") return "user";
  if (s === "assistant" || s === "grok" || s === "ai" || s === "bot" || s === "system")
    return "assistant";
  return null;
}

function parseConversation(obj: unknown): ParsedConversation | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  // Find message list under several common keys
  let raws: unknown[] = [];
  if (Array.isArray(o.messages)) raws = o.messages;
  else if (Array.isArray(o.turns)) raws = o.turns;
  else if (Array.isArray(o.conversation)) raws = o.conversation;
  else if (Array.isArray(o.history)) raws = o.history;
  else if (o.mapping && typeof o.mapping === "object")
    raws = Object.values(o.mapping as Record<string, unknown>);

  const messages: ParsedMessage[] = [];

  for (const m of raws) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, unknown>;
    const inner =
      msg.message && typeof msg.message === "object"
        ? (msg.message as Record<string, unknown>)
        : msg;

    let roleRaw: unknown = inner.role ?? inner.author;
    if (roleRaw && typeof roleRaw === "object" && (roleRaw as any).role)
      roleRaw = (roleRaw as any).role;

    const role = toRole(roleRaw);
    if (!role) continue;

    let content = "";
    if (inner.content && typeof inner.content === "object") {
      const c = inner.content as any;
      content = Array.isArray(c.parts) ? c.parts.map(extractText).join("") : extractText(c);
    } else {
      content = extractText(inner.content ?? inner.text ?? inner.value);
    }

    if (content.trim()) messages.push({ role, content: content.trim() });
  }

  if (messages.length === 0) return null;

  const title =
    typeof o.title === "string"
      ? o.title
      : typeof o.name === "string"
        ? o.name
        : typeof o.subject === "string"
          ? o.subject
          : "Imported conversation";

  return { title: title.slice(0, 255) || "Imported conversation", messages };
}

function parseFileJson(text: string): ParsedConversation[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }

  // 1. Top-level array of conversation objects
  if (Array.isArray(json)) {
    // Check if it looks like an array of conversations
    const first = json[0] as any;
    if (
      first &&
      (Array.isArray(first?.messages) ||
        Array.isArray(first?.turns) ||
        Array.isArray(first?.conversation) ||
        first?.mapping)
    ) {
      return json.flatMap((item) => {
        const c = parseConversation(item);
        return c ? [c] : [];
      });
    }
    // Maybe the array IS the message list (single conversation)
    if (first?.role || first?.author) {
      const c = parseConversation({ messages: json });
      return c ? [c] : [];
    }
    return [];
  }

  // 2. Single conversation object
  const single = parseConversation(json);
  if (single) return [single];

  // 3. Container with a known array key
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const key of ["conversations", "chats", "data", "history", "items", "results", "threads"]) {
      if (Array.isArray(o[key])) {
        const results = (o[key] as unknown[]).flatMap((item) => {
          const c = parseConversation(item);
          return c ? [c] : [];
        });
        if (results.length > 0) return results;
      }
    }
  }

  return [];
}

// ─── Component ────────────────────────────────────────────────────────────────

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

  const processFile = useCallback(async (file: File) => {
    cancelledRef.current = false;
    setPhase("reading");
    setProgress({ done: 0, total: 0, lastTitle: "", statusMsg: "Reading ZIP file…" });
    setResult(null);
    setErrorMsg("");

    // ── 1. Read ZIP in the browser ───────────────────────────────────────────
    let zip: JSZip;
    try {
      const buffer = await file.arrayBuffer();
      zip = await JSZip.loadAsync(buffer);
    } catch (err: any) {
      setErrorMsg(`Could not open ZIP: ${err?.message ?? "unknown error"}. Make sure the file is a valid .zip archive.`);
      setPhase("error");
      return;
    }

    if (cancelledRef.current) return;

    // ── 2. Find and parse JSON files ─────────────────────────────────────────
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

    const allConversations: ParsedConversation[] = [];
    for (const [, entry] of jsonEntries) {
      if (cancelledRef.current) return;
      try {
        const text = await entry.async("string");
        allConversations.push(...parseFileJson(text));
      } catch {
        // skip unreadable files
      }
    }

    if (allConversations.length === 0) {
      setErrorMsg(
        `Found ${jsonEntries.length} JSON file(s) but could not parse any conversations. ` +
        `The format may differ from what's expected. Please share a sample file to get support added.`,
      );
      setPhase("error");
      return;
    }

    // ── 3. Import conversations via existing API endpoints ───────────────────
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
        // Create thread
        const thread = await createThread({ title: convo.title });

        // Import messages as JSON
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

    // Refresh thread list and stats
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
  }, [queryClient]);

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
            Select your Grok export ZIP — conversations are read directly in your
            browser and saved to your vault without uploading the whole file.
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
            aria-label="Click or drag a ZIP file here to import"
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div className={[
              "w-16 h-16 rounded-full flex items-center justify-center transition-colors",
              dragOver ? "bg-primary/20" : "bg-muted",
            ].join(" ")}>
              <FileArchive className={["w-8 h-8 transition-colors", dragOver ? "text-primary" : "text-muted-foreground"].join(" ")} />
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

        {/* ── Reading / Importing ─────────────────────────────────────────── */}
        {(phase === "reading" || phase === "importing") && (
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

            <Button variant="outline" size="sm" onClick={handleClose} className="w-full">
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
