import {
  useListThreads,
  useCreateThread,
  useUpdateThread,
  getListThreadsQueryKey,
  getGetStatsQueryKey,
} from "@workspace/api-client-react";
import { format, isValid } from "date-fns";
import {
  Plus, Search, MessageSquare, Loader2,
  FolderArchive, SlidersHorizontal, X, Pin, PinOff, Flame,
  MoreHorizontal, Archive, ArchiveRestore, Trash2, Zap, User, Bot,
  Brain, ChevronDown, ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Lock } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { BulkImportDialog } from "./bulk-import-dialog";
import { StatsDialog } from "./stats-dialog";
import { ProfileSwitcher } from "./profile-switcher";
import { useProfile } from "@/contexts/profile-context";
import { DeletionFlowDialog } from "./deletion-flow-dialog";

type View = "memories" | "notes" | "archived";

interface SidebarProps {
  activeThreadId: number | null;
  onSelectThread: (id: number) => void;
}

export function Sidebar({ activeThreadId, onSelectThread }: SidebarProps) {
  const searchStr = useSearch();
  const [, navigate] = useLocation();

  // Derive view from URL so nav links and in-app tab clicks stay in sync
  const view: View = (() => {
    const v = new URLSearchParams(searchStr).get("view");
    if (v === "notes") return "notes";
    if (v === "archived") return "archived";
    return "memories";
  })();

  const setView = (v: View) => {
    navigate(v === "memories" ? "/vault" : `/vault?view=${v}`);
  };
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterRole, setFilterRole] = useState<"" | "user" | "assistant">("");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const { activeProfileId } = useProfile();

  const hasActiveFilters = !!filterFrom || !!filterTo || !!filterRole;

  const isNotesView = view === "notes";
  const isArchivedView = view === "archived";

  // Role filter overrides the view-based source:
  //   user      → source=chat (conversations you started)
  //   assistant → source=mcp  (Leo memories / AI-saved notes)
  //   ""        → fall back to view-based source
  const resolvedSource = filterRole === "user"
    ? "chat"
    : filterRole === "assistant"
      ? "mcp"
      : isNotesView ? "mcp" : "chat";

  const threadParams = {
    source: resolvedSource,
    archived: isArchivedView ? true : false,
    search: search || undefined,
    from: filterFrom || undefined,
    to: filterTo || undefined,
    profileId: activeProfileId ?? undefined,
  } as const;

  // Rendering always follows resolvedSource (not the tab) so cross-view role
  // filtering shows the correct template, labels, and action menus.
  const isNotesRendering = resolvedSource === "mcp";

  const { data: threads, isLoading, isRefetching: isRefetchingThreads, dataUpdatedAt: threadsUpdatedAt } = useListThreads(
    threadParams,
    {
      query: {
        queryKey: getListThreadsQueryKey(threadParams),
        // Poll every 30 s when showing mcp (Leo) data so new memories
        // saved in Grok sessions appear automatically — no manual refresh needed.
        refetchInterval: isNotesRendering ? 30_000 : false,
      },
    },
  );

  const createThread = useCreateThread();
  const updateThread = useUpdateThread();
  const queryClient = useQueryClient();

  const handleCreateThread = () => {
    createThread.mutate(
      { data: { title: "New Conversation", profileId: activeProfileId ?? undefined } },
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
    setFilterRole("");
  };

  // Highlight matching search text inside a thread title
  const HighlightMatch = ({ text }: { text: string }) => {
    const term = search.trim();
    if (!term) return <>{text}</>;
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return <>{text}</>;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-primary/25 text-foreground rounded px-0.5">{text.slice(idx, idx + term.length)}</mark>
        {text.slice(idx + term.length)}
      </>
    );
  };

  const handleTogglePin = (e: React.MouseEvent, threadId: number, currentlyPinned: boolean) => {
    e.stopPropagation();
    updateThread.mutate(
      { threadId, data: { pinned: !currentlyPinned } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey(), exact: false, refetchType: "all" });
        },
      },
    );
  };

  const invalidateThreads = () => {
    queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey(), exact: false, refetchType: "all" });
    queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey(), refetchType: "all" });
  };

  const handleToggleArchive = (threadId: number, currentlyArchived: boolean) => {
    updateThread.mutate(
      { threadId, data: { archived: !currentlyArchived } },
      { onSuccess: invalidateThreads },
    );
  };

  const [memoryPanelOpen, setMemoryPanelOpen] = useState(true);

  // ── Memory panel: top pinned + high-weight chat threads ────────────────────
  // A separate lightweight query scoped to chat source so the panel always
  // reflects workspace-level memory context regardless of the active view/filter.
  const memoryPanelParams = {
    source: "chat" as const,
    archived: false,
    profileId: activeProfileId ?? undefined,
  } as const;
  const { data: memoryPanelThreads } = useListThreads(
    memoryPanelParams,
    {
      query: {
        queryKey: getListThreadsQueryKey(memoryPanelParams),
        staleTime: 30_000,
      },
    },
  );

  // Derive top 5: pinned first (in order returned), then by memoryWeight desc.
  const topMemoryThreads = (() => {
    if (!memoryPanelThreads || memoryPanelThreads.length === 0) return [];
    const pinned = memoryPanelThreads.filter((t) => t.pinned);
    const byWeight = memoryPanelThreads
      .filter((t) => !t.pinned && (t.memoryWeight ?? 0) > 0)
      .sort((a, b) => (b.memoryWeight ?? 0) - (a.memoryWeight ?? 0));
    return [...pinned, ...byWeight].slice(0, 5);
  })();

  const [deletionFlowOpen, setDeletionFlowOpen] = useState(false);
  const [deletionTargetId, setDeletionTargetId] = useState<number | null>(null);

  const handleDelete = (e: React.MouseEvent, threadId: number) => {
    e.stopPropagation();
    setDeletionTargetId(threadId);
    setDeletionFlowOpen(true);
  };

  return (
    <div className="flex flex-col h-full w-full bg-card border-r border-border/50">
      {/* Profile switcher */}
      <div className="px-3 pt-3 pb-2 border-b border-border/50">
        <ProfileSwitcher />
      </div>

      {/* Top toolbar */}
      <div className="p-4 border-b border-border/50 space-y-3">
        {!isNotesRendering && (
          <div className="flex items-center gap-2">
            <Button
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleCreateThread}
              disabled={createThread.isPending || !activeProfileId}
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
        )}

        {isNotesRendering && (
          <div className="flex items-center gap-2 px-1">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-semibold text-foreground flex-1">Leo Memories</span>
            {threads && threads.length > 0 && (
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                {threads.length}
              </span>
            )}
            {/* Live sync indicator */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20">
              <span
                className={`w-1.5 h-1.5 rounded-full ${isRefetchingThreads ? "bg-muted-foreground" : "bg-green-500"}`}
              />
              <span className={`text-[10px] font-semibold uppercase tracking-wide ${isRefetchingThreads ? "text-muted-foreground" : "text-green-500"}`}>
                {isRefetchingThreads ? "syncing" : "live"}
              </span>
            </div>
          </div>
        )}

        <BulkImportDialog open={bulkImportOpen} onOpenChange={setBulkImportOpen} />

        {/* Search row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={isNotesRendering ? "Search Leo memories..." : "Search memories..."}
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

        {/* Expandable filter panel */}
        {showFilters && (
          <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-foreground/70">Filters</span>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-primary flex items-center gap-1 hover:underline"
                >
                  <X className="w-3 h-3" /> Clear all
                </button>
              )}
            </div>

            {/* Role filter */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Show</label>
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { value: "" as const, label: "All", icon: null },
                    { value: "user" as const, label: "Conversations", icon: User },
                    { value: "assistant" as const, label: "Leo Memories", icon: Bot },
                  ] as const
                ).map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setFilterRole(value)}
                    className={`flex-1 flex items-center justify-center gap-1 h-7 rounded-md text-xs border transition-colors ${
                      filterRole === value
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    {Icon && <Icon className="w-3 h-3 shrink-0" />}
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date range */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Date range</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground/60 mb-1 block">From</label>
                  <Input
                    type="date"
                    value={filterFrom}
                    onChange={(e) => setFilterFrom(e.target.value)}
                    className="h-8 text-xs bg-background/50 border-border/50 [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground/60 mb-1 block">To</label>
                  <Input
                    type="date"
                    value={filterTo}
                    onChange={(e) => setFilterTo(e.target.value)}
                    className="h-8 text-xs bg-background/50 border-border/50 [color-scheme:dark]"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View toggle: Memories | Leo Notes | Archived */}
        <div className="flex items-center gap-1 text-sm">
          <Button
            variant="ghost"
            size="sm"
            className={`flex-1 h-8 rounded-md text-xs ${view === "memories" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
            onClick={() => setView("memories")}
          >
            Memories
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`flex-1 h-8 rounded-md text-xs flex items-center gap-1 ${view === "notes" ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
            onClick={() => setView("notes")}
          >
            <Zap className="w-3 h-3 shrink-0" />
            Leo Memories
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`flex-1 h-8 rounded-md text-xs ${view === "archived" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
            onClick={() => setView("archived")}
          >
            Archived
          </Button>
        </div>
      </div>

      {/* ── Memory Panel ─────────────────────────────────────────────────── */}
      {/* Shown only in the Memories view; not shown when browsing Leo Notes or Archived */}
      {!isNotesRendering && !isArchivedView && topMemoryThreads.length > 0 && (
        <div className="border-b border-border/50 px-2 py-2">
          {/* Header row */}
          <button
            className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted/60 transition-colors text-left"
            onClick={() => setMemoryPanelOpen((o) => !o)}
            title={memoryPanelOpen ? "Collapse memory panel" : "Expand memory panel"}
          >
            <Brain className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-xs font-semibold text-foreground flex-1">What Leo knows</span>
            <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
              {topMemoryThreads.length}
            </span>
            {memoryPanelOpen
              ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
              : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
          </button>

          {/* Thread rows */}
          {memoryPanelOpen && (
            <div className="mt-1 space-y-0.5">
              {topMemoryThreads.map((thread) => (
                <div
                  key={thread.id}
                  className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                    activeThreadId === thread.id
                      ? "bg-primary/10 text-foreground"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => onSelectThread(thread.id)}
                  title={thread.title}
                >
                  {/* Pin toggle */}
                  <button
                    onClick={(e) => handleTogglePin(e, thread.id, thread.pinned)}
                    title={thread.pinned ? "Unpin" : "Pin to memory"}
                    className={`shrink-0 p-0.5 rounded transition-all ${
                      thread.pinned
                        ? "text-primary opacity-100"
                        : "text-muted-foreground opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    {thread.pinned
                      ? <Pin className="w-3 h-3 fill-primary" />
                      : <PinOff className="w-3 h-3" />}
                  </button>

                  {/* Title */}
                  <span className="text-xs truncate flex-1">{thread.title}</span>

                  {/* Memory weight badge */}
                  {(thread.memoryWeight ?? 0) > 0 && (
                    <span
                      title={`Retrieved ${thread.memoryWeight} time${thread.memoryWeight === 1 ? "" : "s"}`}
                      className="flex items-center gap-0.5 text-[10px] text-amber-400/80 shrink-0"
                    >
                      <Flame className="w-2.5 h-2.5" />
                      {thread.memoryWeight}
                    </span>
                  )}
                </div>
              ))}

              {/* Footer: link to full memories view */}
              <button
                className="w-full text-[10px] text-muted-foreground/60 hover:text-primary transition-colors text-center pt-1 pb-0.5"
                onClick={() => setView("memories")}
              >
                Browse all memories →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Thread / Notes list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading ? (
            <div className="p-4 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : threads?.length === 0 ? (
            <div className="p-6 text-center space-y-1">
              {isNotesRendering ? (
                <>
                  <Zap className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No Leo memories yet</p>
                  <p className="text-xs text-muted-foreground/60">
                    Ask Leo to save a memory and it will sync here automatically
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">No memories found</p>
                  {(search || hasActiveFilters) && (
                    <p className="text-xs text-muted-foreground/60">Try different keywords or dates</p>
                  )}
                </>
              )}
            </div>
          ) : isNotesRendering ? (
            /* Leo Notes view */
            threads?.map((note) => (
              <div
                key={note.id}
                className={`group relative w-full text-left p-3 rounded-lg transition-colors flex flex-col gap-1 cursor-pointer ${
                  activeThreadId === note.id
                    ? "bg-primary/10 border border-primary/20 text-foreground"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground border border-transparent"
                }`}
                onClick={() => onSelectThread(note.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium truncate text-sm flex-1"><HighlightMatch text={note.title} /></span>
                  <div className="flex items-center gap-1 shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                          title="Note actions"
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const ageMs = Date.now() - new Date(note.createdAt).getTime();
                          const isRecent = ageMs < 30 * 24 * 60 * 60 * 1000;
                          const daysLeft = Math.ceil((30 * 24 * 60 * 60 * 1000 - ageMs) / (24 * 60 * 60 * 1000));
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DropdownMenuItem
                                  disabled={isRecent}
                                  onClick={isRecent ? undefined : (e) => handleDelete(e, note.id)}
                                  className={isRecent
                                    ? "opacity-40 cursor-not-allowed text-muted-foreground"
                                    : "text-destructive focus:bg-destructive/10"}
                                >
                                  {isRecent
                                    ? <><Lock className="w-4 h-4 mr-2" />Delete<span className="ml-auto text-xs">30d lock</span></>
                                    : <><Trash2 className="w-4 h-4 mr-2" />Delete</>}
                                </DropdownMenuItem>
                              </TooltipTrigger>
                              {isRecent && (
                                <TooltipContent side="right" className="max-w-[180px] text-center">
                                  Protected for {daysLeft} more day{daysLeft !== 1 ? "s" : ""}. Notes cannot be deleted within 30 days of creation.
                                </TooltipContent>
                              )}
                            </Tooltip>
                          );
                        })()}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs opacity-70">
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    Leo memory
                  </span>
                  {isValid(new Date(note.createdAt)) && (
                    <span>synced {format(new Date(note.createdAt), "MMM d, yyyy")}</span>
                  )}
                </div>
              </div>
            ))
          ) : (
            /* Memories / Archived view */
            threads?.map((thread) => (
              <div
                key={thread.id}
                className={`group relative w-full text-left p-3 rounded-lg transition-colors flex flex-col gap-1 cursor-pointer ${
                  activeThreadId === thread.id
                    ? "bg-primary/10 border border-primary/20 text-foreground"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground border border-transparent"
                }`}
                onClick={() => onSelectThread(thread.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium truncate text-sm flex-1"><HighlightMatch text={thread.title} /></span>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Memory weight badge */}
                    {(thread.memoryWeight ?? 0) > 0 && (
                      <span
                        title={`Retrieved ${thread.memoryWeight} time${thread.memoryWeight === 1 ? "" : "s"}`}
                        className="flex items-center gap-0.5 text-xs text-amber-400/80 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Flame className="w-3 h-3" />
                        {thread.memoryWeight}
                      </span>
                    )}
                    {/* Pin toggle */}
                    <button
                      onClick={(e) => handleTogglePin(e, thread.id, thread.pinned)}
                      title={thread.pinned ? "Unpin" : "Pin to always include in memory"}
                      className={`p-0.5 rounded transition-all ${
                        thread.pinned
                          ? "text-primary opacity-100"
                          : "text-muted-foreground opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      {thread.pinned
                        ? <Pin className="w-3 h-3 fill-primary" />
                        : <PinOff className="w-3 h-3" />}
                    </button>
                    {/* Thread actions dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                          title="Thread actions"
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => handleToggleArchive(thread.id, thread.archived ?? false)}>
                          {thread.archived
                            ? <><ArchiveRestore className="w-4 h-4 mr-2" />Unarchive</>
                            : <><Archive className="w-4 h-4 mr-2" />Archive</>}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {(() => {
                          const ageMs = Date.now() - new Date(thread.createdAt).getTime();
                          const isRecent = ageMs < 30 * 24 * 60 * 60 * 1000;
                          const daysLeft = Math.ceil((30 * 24 * 60 * 60 * 1000 - ageMs) / (24 * 60 * 60 * 1000));
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DropdownMenuItem
                                  disabled={isRecent}
                                  onClick={isRecent ? undefined : (e) => handleDelete(e, thread.id)}
                                  className={isRecent
                                    ? "opacity-40 cursor-not-allowed text-muted-foreground"
                                    : "text-destructive focus:bg-destructive/10"}
                                >
                                  {isRecent
                                    ? <><Lock className="w-4 h-4 mr-2" />Delete<span className="ml-auto text-xs">30d lock</span></>
                                    : <><Trash2 className="w-4 h-4 mr-2" />Delete</>}
                                </DropdownMenuItem>
                              </TooltipTrigger>
                              {isRecent && (
                                <TooltipContent side="right" className="max-w-[180px] text-center">
                                  Protected for {daysLeft} more day{daysLeft !== 1 ? "s" : ""}. Threads cannot be deleted within 30 days of creation.
                                </TooltipContent>
                              )}
                            </Tooltip>
                          );
                        })()}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
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
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {deletionFlowOpen && deletionTargetId !== null && (
        <DeletionFlowDialog
          open={deletionFlowOpen}
          onOpenChange={setDeletionFlowOpen}
          targetType="thread"
          targetIds={[deletionTargetId]}
          onSuccess={invalidateThreads}
        />
      )}
    </div>
  );
}
