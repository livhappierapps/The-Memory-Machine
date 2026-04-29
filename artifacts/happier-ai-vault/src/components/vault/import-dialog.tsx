import { useState } from "react";
import { useImportMessages, getGetThreadMessagesQueryKey, getGetStatsQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

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
          description: `Imported ${result.importedCount} messages into the vault.`,
        });
        setContent("");
        onOpenChange(false);
        queryClient.invalidateQueries({ queryKey: getGetThreadMessagesQueryKey(threadId) });
        queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
      },
      onError: (err) => {
        toast({
          title: "Import Failed",
          description: "Could not parse or import the messages.",
          variant: "destructive"
        });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Import Conversation</DialogTitle>
          <DialogDescription>
            Paste raw text or JSON from another Grok conversation. The vault will automatically parse user and assistant messages.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          <Textarea 
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste conversation here..."
            className="min-h-[300px] font-mono text-xs"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={!content.trim() || importMessages.isPending}>
            {importMessages.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Import Messages
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}