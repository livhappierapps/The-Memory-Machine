import { useState } from "react";
import { useImportMessages, getGetThreadMessagesQueryKey, getGetStatsQueryKey, getListThreadsQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Info } from "lucide-react";

interface ImportDialogProps {
  threadId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportDialog({ threadId, open, onOpenChange }: ImportDialogProps) {
  const [content, setContent] = useState("");
  const importMessages = useImportMessages();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleImport = () => {
    if (!content.trim()) return;

    importMessages.mutate({
      threadId,
      data: {
        raw: content,
        format: "auto"
      }
    }, {
      onSuccess: (result) => {
        toast({
          title: "Import Successful",
          description: `Imported ${result.importedCount} message${result.importedCount === 1 ? "" : "s"} into the vault.`,
        });
        setContent("");
        onOpenChange(false);
        queryClient.invalidateQueries({ queryKey: getGetThreadMessagesQueryKey(threadId), exact: false, refetchType: "all" } as any);
        queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey(), exact: false, refetchType: "all" } as any);
        queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey(), exact: false, refetchType: "all" } as any);
      },
      onError: () => {
        toast({
          title: "Import Failed",
          description: "Couldn't parse any messages. Make sure you copied the full conversation from Grok, or check the format instructions.",
          variant: "destructive"
        });
      }
    });
  };

  const handleClose = () => {
    setContent("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Import Conversation</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Paste a Grok conversation below. The vault will detect user and assistant turns automatically.</p>
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* How-to instructions */}
        <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm space-y-1.5">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <Info className="w-4 h-4 text-primary shrink-0" />
            How to copy from Grok
          </div>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground pl-1">
            <li>Open the conversation on <span className="font-mono text-xs bg-muted px-1 rounded">grok.com</span></li>
            <li>Click inside the chat, press <span className="font-mono text-xs bg-muted px-1 rounded">Ctrl+A</span> (or <span className="font-mono text-xs bg-muted px-1 rounded">⌘A</span>) to select all</li>
            <li>Copy (<span className="font-mono text-xs bg-muted px-1 rounded">Ctrl+C</span> / <span className="font-mono text-xs bg-muted px-1 rounded">⌘C</span>) and paste below</li>
          </ol>
          <p className="text-muted-foreground/80 text-xs pt-0.5">
            Also accepts JSON arrays: <span className="font-mono">[{"{"}"role":"user","content":"..."{"}"}, ...]</span>
          </p>
        </div>

        <div>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`You\nWhat is the meaning of life?\n\nGrok\nGreat question! The meaning of life...`}
            className="min-h-[220px] font-mono text-xs"
          />
          {content.trim() && (
            <p className="text-xs text-muted-foreground mt-1.5 pl-0.5">
              {content.trim().split("\n").length} lines pasted
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleImport}
            disabled={!content.trim() || importMessages.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {importMessages.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Import Messages
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
