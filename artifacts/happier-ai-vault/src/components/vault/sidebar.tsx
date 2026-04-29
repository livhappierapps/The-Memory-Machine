import { useListThreads, useCreateThread, useGetStats, getListThreadsQueryKey, getGetStatsQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Plus, Search, Archive, MessageSquare, Loader2, BarChart2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface SidebarProps {
  activeThreadId: number | null;
  onSelectThread: (id: number) => void;
}

export function Sidebar({ activeThreadId, onSelectThread }: SidebarProps) {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  
  const { data: threads, isLoading } = useListThreads(
    { search: search || undefined, archived: showArchived },
    { query: { queryKey: getListThreadsQueryKey({ search: search || undefined, archived: showArchived }) } }
  );

  const createThread = useCreateThread();
  const queryClient = useQueryClient();

  const handleCreateThread = () => {
    createThread.mutate({
      data: { title: "New Conversation" }
    }, {
      onSuccess: (thread) => {
        queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
        onSelectThread(thread.id);
      }
    });
  };

  return (
    <div className="w-80 flex flex-col h-full bg-card border-r border-border/50">
      <div className="p-4 border-b border-border/50 space-y-4">
        <div className="flex items-center gap-2">
          <Button 
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90" 
            onClick={handleCreateThread}
            disabled={createThread.isPending}
          >
            {createThread.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            New Vault
          </Button>
          <StatsDialog />
        </div>
        
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder="Search vault..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-background/50 border-border/50"
          />
        </div>
        
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

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading ? (
            <div className="p-4 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : threads?.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No threads found
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
                  <span className="font-medium truncate text-sm">
                    {thread.title}
                  </span>
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

function StatsDialog() {
  const { data: stats } = useGetStats({ query: { queryKey: getGetStatsQueryKey() } });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0 bg-background/50 border-border/50" title="Vault Statistics">
          <BarChart2 className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vault Statistics</DialogTitle>
        </DialogHeader>
        {stats ? (
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Total Threads</div>
              <div className="text-2xl font-mono">{stats.totalThreads}</div>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Total Messages</div>
              <div className="text-2xl font-mono">{stats.totalMessages}</div>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">User Messages</div>
              <div className="text-2xl font-mono">{stats.userMessages}</div>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">AI Messages</div>
              <div className="text-2xl font-mono">{stats.assistantMessages}</div>
            </div>
            <div className="col-span-2 bg-muted/50 p-4 rounded-lg flex justify-between">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Active</div>
                <div className="font-mono">{stats.activeThreads}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground mb-1">Archived</div>
                <div className="font-mono">{stats.archivedThreads}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        )}
      </DialogContent>
    </Dialog>
  );
}