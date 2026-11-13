import { useState } from "react";
import { useGetStats, getGetStatsQueryKey } from "@workspace/api-client-react";
import { useProfile } from "@/contexts/profile-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, BarChart2 } from "lucide-react";

export function StatsDialog() {
  const [open, setOpen] = useState(false);
  const { data: stats } = useGetStats(
    {},
    { query: { queryKey: getGetStatsQueryKey(), enabled: open } }
  );
  const { profiles } = useProfile();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Vault Statistics</DialogTitle>
        </DialogHeader>

        {stats ? (
          <Tabs defaultValue="global">
            <TabsList className="w-full mb-4">
              <TabsTrigger value="global" className="flex-1">
                Overall
              </TabsTrigger>
              {profiles.length > 1 && (
                <TabsTrigger value="profiles" className="flex-1">
                  By Profile
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="global">
              <div className="grid grid-cols-2 gap-4">
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
            </TabsContent>

            {profiles.length > 1 && (
              <TabsContent value="profiles">
                <div className="space-y-3">
                  {(stats.profiles ?? []).map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 bg-muted/50 p-4 rounded-lg"
                    >
                      {/* Color dot + emoji */}
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0"
                        style={{ backgroundColor: p.color }}
                      >
                        {p.emoji}
                      </div>
                      {/* Name */}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.messageCount} message{p.messageCount !== 1 ? "s" : ""}
                        </div>
                      </div>
                      {/* Thread count */}
                      <div className="text-right shrink-0">
                        <div className="text-lg font-mono">{p.threadCount}</div>
                        <div className="text-xs text-muted-foreground">
                          thread{p.threadCount !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(stats.profiles ?? []).length === 0 && (
                    <div className="text-center text-muted-foreground py-6 text-sm">
                      No profile data available
                    </div>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>
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
