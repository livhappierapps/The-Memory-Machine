import { useGetStats, getGetStatsQueryKey } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, BarChart2 } from "lucide-react";

export function StatsDialog() {
  const { data: stats } = useGetStats({ query: { queryKey: getGetStatsQueryKey() } });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0 bg-background/50 border-border/50"
          title="Vault Statistics"
        >
          <BarChart2 className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vault Statistics</DialogTitle>
        </DialogHeader>

        {stats ? (
          <div className="grid grid-cols-2 gap-4 py-4">
            <StatCard label="Total Threads" value={stats.totalThreads} />
            <StatCard label="Total Messages" value={stats.totalMessages} />
            <StatCard label="User Messages" value={stats.userMessages} />
            <StatCard label="AI Messages" value={stats.assistantMessages} />
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
          <div className="flex justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-muted/50 p-4 rounded-lg">
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-mono">{value}</div>
    </div>
  );
}
