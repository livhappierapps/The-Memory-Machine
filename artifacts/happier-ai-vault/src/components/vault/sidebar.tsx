import {
  useListThreads,
  useCreateThread,
  getListThreadsQueryKey,
  getGetStatsQueryKey,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Plus, Search, MessageSquare, Loader2, BarChart2, FolderArchive } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BulkImportDialog } from "./bulk-import-dialog";
import { StatsDialog } from "./stats-dialog";

interface SidebarProps {
  activeThreadId: number | null;
  onSelectThread: (id: number) => void;
}

export function Sidebar({ activeThreadId, onSelectThread }: SidebarProps) {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const { data: threads, isLoading } = useListThreads(
    { search: search || undefined, archived: showArchived },
    {
      query: {
        queryKey: getListThreadsQueryKey({ search: search || undefined, archived: showArchived }),
      },
    },
  );

  const createThread = useCreateThread();
  const queryClient = useQueryClient();

  const handleCreateThread = () => {
    createThread.mutate(
      { data: { title: "New Conversation" } },
      {
        onSuccess: (thread) => {
          queryClient.invalidateQueries({
            queryKey: getListThreadsQueryKey(),
            exact: false,
            refetchType: "all",
          });
          queryClient.invalidateQueries({
            queryKey: getGetStatsQueryKey(),
            refetchType: "all",
          });
          onSelectThread(thread.id);
        },
      },
    );
  };

  return (
    <div className="flex flex-col h-full w-full bg-card border-r border-border/50">
      {/* Top toolbar */}
      <div className="p-4 border-b border-border/50 space-y-4">
        <div className="flex items-center gap-2">
          <Button
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleCreateThread}
            disabled={createThread.isPending}
          >
            {createThread.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            New Vault
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="shrink-0 bg-background/50 border-border/50"
            title="Import Grok ZIP Archive"
            onClick={() => setBulkImportOpen(true)}
          >
            <FolderArchive className="w-4 h-4" />
          </Button>

          <StatsDialog />
        </div>

        <BulkImportDialog open={bulkImportOpen} onOpenChange={setBulkImportOpen} />

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search vault..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-background/50 border-border/50"
          />
        </div>

        {/* Active / Archived toggle */}
        <div className="flex items-center gap-2 text-sm">
          <Button
            variant="ghost"
            size="sm"
            className={`flex-1 h-8 rounded-md ${!showArchived ? "bg-muted text-foreground" : "text-muted-foreground"}`}
            onClick={() => setShowArchived(false)}
          >
            Active
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`flex-1 h-8 rounded-md ${showArchived ? "bg-muted text-foreground" : "text-muted-foreground"}`}
            onClick={() => setShowArchived(true)}
          >
            Archived
          </Button>
        </div>
      </div>

      {/* Thread list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading ? (
            <div className="p-4 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : threads?.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No threads found</div>
          ) : (
            threads?.map((thread) => (
              <button
                key={thread.id}
                onClick={() => onSelectThread(thread.id)}
                className={`w-full text-left p-3 rounded-lg transition-colors flex flex-col gap-1 ${
                  activeThreadId === thread.id
                    ? "bg-primary/10 border border-primary/20 text-foreground"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium truncate text-sm">{thread.title}</span>
                  {thread.pinned && (
                    <span className="shrink-0 w-2 h-2 rounded-full bg-primary mt-1.5" />
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs opacity-70">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    {thread.messageCount}
                  </span>
                  <span>{format(new Date(thread.updatedAt), "MMM d, yyyy")}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
