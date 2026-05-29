import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Archive, RotateCcw, Trash2, Plus } from "lucide-react";

interface Snapshot {
  id: number;
  label: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SnapshotsSection() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [fetching, setFetching] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [restoreLog, setRestoreLog] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<number | null>(null);
  const { toast } = useToast();

  const loadSnapshots = async () => {
    try {
      const res = await fetch("/api/security/snapshots", { credentials: "include" });
      if (res.ok) setSnapshots(await res.json());
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => { loadSnapshots(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/security/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ label: `Manual snapshot ${new Date().toLocaleDateString()}` }),
      });
      if (res.ok) {
        const snap = await res.json();
        setSnapshots((s) => [snap, ...s]);
        toast({ title: "Snapshot created", description: `${formatBytes(snap.sizeBytes)} — expires ${new Date(snap.expiresAt).toLocaleDateString()}` });
      } else {
        const d = await res.json();
        toast({ title: "Error", description: d.error ?? "Could not create snapshot", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (id: number) => {
    setRestoring(id);
    setRestoreLog([]);
    try {
      const res = await fetch(`/api/security/snapshots/${id}/restore`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.body) {
        toast({ title: "Error", description: "No response stream", variant: "destructive" });
        setRestoring(null);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.replace(/^data:\s*/, "");
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as { message?: string; done?: boolean; error?: string };
            if (parsed.error) {
              setRestoreLog((l) => [...l, `Error: ${parsed.error}`]);
            } else if (parsed.done) {
              setRestoreLog((l) => [...l, "Restore complete."]);
              toast({ title: "Restore complete", description: "Your conversations have been restored." });
              loadSnapshots();
            } else if (parsed.message) {
              setRestoreLog((l) => [...l, parsed.message!]);
            }
          } catch {
            // ignore non-JSON lines
          }
        }
      }
    } catch {
      toast({ title: "Network error", description: "Restore stream failed.", variant: "destructive" });
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/security/snapshots/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setSnapshots((s) => s.filter((x) => x.id !== id));
        toast({ title: "Snapshot deleted" });
      } else {
        toast({ title: "Error", description: "Could not delete snapshot", variant: "destructive" });
      }
    } finally {
      setDeleting(null);
    }
  };

  if (fetching) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {snapshots.length === 0 && (
        <p className="text-sm text-muted-foreground">No snapshots yet. Create one to back up your current conversations.</p>
      )}

      {snapshots.length > 0 && (
        <div className="space-y-2">
          {snapshots.map((s) => (
            <div
              key={s.id}
              className="rounded-lg border border-border/50 bg-background px-4 py-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <Archive className="w-4 h-4 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{s.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(s.sizeBytes)} · {new Date(s.createdAt).toLocaleDateString()} · expires {new Date(s.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-3 shrink-0">
                  <button
                    onClick={() => handleRestore(s.id)}
                    disabled={restoring !== null || deleting === s.id}
                    className="p-1.5 rounded text-muted-foreground hover:text-primary transition-colors"
                    title="Restore snapshot"
                  >
                    {restoring === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    disabled={deleting === s.id || restoring !== null}
                    className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete snapshot"
                  >
                    {deleting === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {restoring === s.id && restoreLog.length > 0 && (
                <div className="bg-muted/30 rounded p-2 max-h-24 overflow-y-auto font-mono text-xs text-muted-foreground space-y-0.5">
                  {restoreLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={handleCreate}
        disabled={creating}
      >
        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Create Snapshot
      </Button>
    </div>
  );
}
