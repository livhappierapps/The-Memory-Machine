import { useGetThread, useGetThreadMessages, useUpdateThread, useDeleteThread, getGetThreadQueryKey, getListThreadsQueryKey, getGetThreadMessagesQueryKey, getGetStatsQueryKey } from "@workspace/api-client-react";
import { useChatStream } from "@/hooks/use-chat-stream";
import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Send, Settings2, Trash2, Archive, ArchiveRestore, Download, MoreVertical, Loader2, StopCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ImportDialog } from "./import-dialog";
import { ExportDialog } from "./export-dialog";

export function ChatArea({ threadId }: { threadId: number }) {
  const { data: thread, isLoading: threadLoading } = useGetThread(threadId, {
    query: { enabled: !!threadId, queryKey: getGetThreadQueryKey(threadId) }
  });
  
  const { data: messages, isLoading: messagesLoading } = useGetThreadMessages(threadId, {
    query: { enabled: !!threadId, queryKey: getGetThreadMessagesQueryKey(threadId) }
  });

  const [input, setInput] = useState("");
  const { streamMessage, stopStream, isStreaming, streamingContent, error } = useChatStream();
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const updateThread = useUpdateThread();
  const deleteThread = useDeleteThread();
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  if (threadLoading || messagesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!thread) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isStreaming) return;

    const content = input;
    setInput("");
    await streamMessage(threadId, content);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleToggleArchive = () => {
    updateThread.mutate({
      threadId,
      data: { archived: !thread.archived }
    }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetThreadQueryKey(threadId), data);
        queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
      }
    });
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this vault? This cannot be undone.")) {
      deleteThread.mutate({ threadId }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
          window.location.reload(); // Simple way to clear active thread
        }
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background/30 relative">
      {/* Header */}
      <header className="h-16 px-6 border-b border-border/50 flex items-center justify-between shrink-0 bg-background/50 backdrop-blur-sm z-10">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            {thread.title}
            {thread.archived && <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">Archived</span>}
          </h2>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            Model: {thread.model}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setIsImportOpen(true)}>
                <Upload className="w-4 h-4 mr-2" /> Import Messages
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsExportOpen(true)}>
                <Download className="w-4 h-4 mr-2" /> Export Vault
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleToggleArchive}>
                {thread.archived ? <ArchiveRestore className="w-4 h-4 mr-2" /> : <Archive className="w-4 h-4 mr-2" />}
                {thread.archived ? "Unarchive" : "Archive"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:bg-destructive/10">
                <Trash2 className="w-4 h-4 mr-2" /> Delete Vault
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Messages */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6"
      >
        {messages?.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <p className="mb-2">This vault is empty.</p>
            <p className="text-sm">Send a message to start the conversation, or import history.</p>
            <Button variant="outline" className="mt-4" onClick={() => setIsImportOpen(true)}>
              <Upload className="w-4 h-4 mr-2" /> Import History
            </Button>
          </div>
        ) : (
          messages?.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex flex-col max-w-3xl ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
            >
              <div 
                className={`px-4 py-3 rounded-2xl ${
                  msg.role === 'user' 
                    ? 'bg-primary/20 text-foreground rounded-tr-sm border border-primary/20' 
                    : 'bg-card border border-border/50 rounded-tl-sm shadow-sm'
                }`}
              >
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {/* Super basic markdown rendering for simplicity - ideally use react-markdown */}
                  <pre className="whitespace-pre-wrap font-sans text-sm m-0 bg-transparent p-0">{msg.content}</pre>
                </div>
              </div>
              <div className="flex gap-2 items-center mt-1.5 text-xs text-muted-foreground px-1 opacity-60">
                <span>{msg.role === 'user' ? 'You' : 'Grok'}</span>
                <span>•</span>
                <span>{format(new Date(msg.createdAt), "h:mm a")}</span>
              </div>
            </div>
          ))
        )}

        {/* Streaming Message Indicator */}
        {(isStreaming && streamingContent) && (
          <div className="flex flex-col max-w-3xl mr-auto items-start">
            <div className="px-4 py-3 rounded-2xl bg-card border border-border/50 rounded-tl-sm shadow-sm">
              <pre className="whitespace-pre-wrap font-sans text-sm m-0 bg-transparent p-0">{streamingContent}</pre>
            </div>
          </div>
        )}
        
        {error && (
          <div className="p-4 my-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-sm text-center">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 bg-background/80 backdrop-blur-md border-t border-border/50">
        <form 
          onSubmit={handleSubmit}
          className="max-w-4xl mx-auto relative flex items-end gap-2 bg-card border border-border focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50 transition-all rounded-xl p-2 shadow-sm"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={thread.archived ? "This vault is archived." : "Message Grok..."}
            className="min-h-[50px] max-h-[200px] resize-none border-0 focus-visible:ring-0 shadow-none bg-transparent py-3 text-base"
            disabled={thread.archived || isStreaming}
          />
          <div className="shrink-0 mb-1">
            {isStreaming ? (
              <Button type="button" size="icon" variant="secondary" className="rounded-lg h-10 w-10" onClick={stopStream}>
                <StopCircle className="w-5 h-5 text-destructive" />
              </Button>
            ) : (
              <Button 
                type="submit" 
                size="icon" 
                className="rounded-lg h-10 w-10 bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={!input.trim() || thread.archived}
              >
                <Send className="w-5 h-5" />
              </Button>
            )}
          </div>
        </form>
        <div className="text-center mt-2 text-xs text-muted-foreground">
          Shift + Enter for new line
        </div>
      </div>

      <ImportDialog threadId={threadId} open={isImportOpen} onOpenChange={setIsImportOpen} />
      <ExportDialog threadId={threadId} title={thread.title} open={isExportOpen} onOpenChange={setIsExportOpen} />
    </div>
  );
}