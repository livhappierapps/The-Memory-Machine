import {
  useListThreads,
  useCreateThread,
  getListThreadsQueryKey,
  getGetStatsQueryKey,
} from "@workspace/api-client-react";
import { format, isValid } from "date-fns";
import {
  Plus, Search, MessageSquare, Loader2, BarChart2,
  FolderArchive, SlidersHorizontal, X, Pin,
} from "lucide-react";
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
  const [showFilters, setShowFilters] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const hasActiveFilters = !!filterFrom || !!filterTo;

  const { data: threads, isLoading } = useListThreads(
    {
      search: search || undefined,
      archived: showArchived,
      from: filterFrom || undefined,
      to: filterTo || undefined,
    },
    {
      query: {
        queryKey: getListThreadsQueryKey({
          search: search || undefined,
          archived: showArchived,
          from: filterFrom || undefined,
          to: filterTo || undefined,
        }),
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

  const clearFilters = () => {
    setFilterFrom("");
    setFilterTo("");
  };

  return (
    <div className="flex flex-col h-full w-full bg-card border-r border-border/50">
      {/* Top toolbar */}
      <div className="p-4 border-b border-border/50 space-y-3">
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
            New Memory
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

        {/* Search row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search memories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-background/50 border-border/50"
            />
          </div>

          {/* Filter toggle */}
          <Button
            variant="outline"
            size="icon"
            title="Date filters"
            onClick={() => setShowFilters((v) => !v)}
            className={`shrink-0 border-border/50 ${
              showFilters || hasActiveFilters
                ? "bg-primary/10 border-primary/40 text-primary"
                : "bg-background/50 text-muted-foreground"
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            {hasActiveFilters && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />
            )}
          </Button>
        </div>

        {/* Expandable date filter panel */}
        {showFilters && (
          <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-foreground/70">Filter by date</span>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-primary flex items-center gap-1 hover:underline"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">From</label>
                <Input
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  className="h-8 text-xs bg-background/50 border-border/50 [color-scheme:dark]"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">To</label>
                <Input
                  type="date"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                  className="h-8 text-xs bg-background/50 border-border/50 [color-scheme:dark]"
                />
              </div>
            </div>
          </div>
        )}

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
            <div className="p-6 text-center space-y-1">
              <p className="text-sm text-muted-foreground">No memories found</p>
              {(search || hasActiveFilters) && (
                <p className="text-xs text-muted-foreground/60">Try different keywords or dates</p>
              )}
            </div>
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
                    <Pin className="w-3 h-3 shrink-0 text-primary mt-0.5 fill-primary" />
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs opacity-70">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    {thread.messageCount}
                  </span>
                  {isValid(new Date(thread.updatedAt)) && (
                    <span>{format(new Date(thread.updatedAt), "MMM d, yyyy")}</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
