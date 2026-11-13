import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RotateCcw, Trash2, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface DeletedThread {
  id: number;
  title: string;
  deletedAt: string;
  messageCount: number;
}

interface DeletedThreadsPanelProps {
  onRestored?: () => void;
}

export function DeletedThreadsPanel({ onRestored }: DeletedThreadsPanelProps) {
  const [threads, setThreads] = useState<DeletedThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const { toast } = useToast();

  const fetchDeleted = async () => {
    try {
      const res = await fetch("/api/threads/deleted", { credentials: "include" });
      if (res.ok) setThreads(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeleted();
  }, []);

  const handleRestore = async (id: number) => {
    setRestoringId(id);
    try {
      const res = await fetch(`/api/threads/${id}/restore`, {
        method: "PATCH",
        credentials: "include",
      });
      if (res.ok) {
        setThreads((prev) => prev.filter((t) => t.id !== id));
        toast({ title: "Conversation restored", description: "It's back in your active list." });
        onRestored?.();
      } else {
        toast({ title: "Failed to restore", variant: "destructive" });
      }
    } finally {
      setRestoringId(null);
    }
  };

  function expiresIn(deletedAt: string): string {
    const restoreDeadline = new Date(new Date(deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000);
    const diffDays = Math.ceil((restoreDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return "Expiring soon";
    return `${diffDays}d left to restore`;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        <Trash2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p>No recently deleted conversations</p>
        <p className="text-xs mt-1">Deleted conversations appear here for 30 days before being permanently removed.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-80">
      <div className="space-y-2">
        {threads.map((thread) => (
          <div key={thread.id} className="flex items-center gap-3 p-3 bg-background/50 border border-border/40 rounded-lg">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{thread.title}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <Clock className="w-3 h-3" />
                <span>Deleted {format(new Date(thread.deletedAt), "MMM d")}</span>
                <span className="text-amber-400">· {expiresIn(thread.deletedAt)}</span>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleRestore(thread.id)}
              disabled={restoringId === thread.id}
              className="shrink-0 gap-1.5 text-xs"
            >
              {restoringId === thread.id
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <RotateCcw className="w-3 h-3" />}
              Restore
            </Button>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
