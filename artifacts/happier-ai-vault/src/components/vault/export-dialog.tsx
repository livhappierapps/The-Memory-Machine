import { useState } from "react";
import { useExportThread } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ExportDialogProps {
  threadId: number;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportDialog({ threadId, title, open, onOpenChange }: ExportDialogProps) {
  const [format, setFormat] = useState<"json" | "markdown">("markdown");
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${basePath}/api/threads/${threadId}/export?format=${format}`, {
        credentials: "include"
      });
      
      if (!res.ok) throw new Error("Failed to export");
      
      const data = await res.json();
      
      // Trigger download
      const blob = new Blob([data.content], { type: format === "json" ? "application/json" : "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vault_${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${format === "json" ? "json" : "md"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Export Successful",
        description: `Your vault has been downloaded as ${format.toUpperCase()}.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Export Failed",
        description: "An error occurred while preparing your export.",
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Export Vault</DialogTitle>
          <DialogDescription>
            Download a complete copy of this conversation.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Format</label>
            <Select value={format} onValueChange={(v: "json" | "markdown") => setFormat(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="markdown">Markdown (.md)</SelectItem>
                <SelectItem value="json">JSON (.json)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}