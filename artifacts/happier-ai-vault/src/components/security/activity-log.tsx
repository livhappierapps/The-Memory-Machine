import { useGetAuditLog } from "@workspace/api-client-react";
import { Loader2, ShieldCheck, KeyRound, Smartphone, Archive, RotateCcw, Trash2, AlertTriangle, Activity } from "lucide-react";

const ACTION_META: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  sign_in: {
    label: "Sign-in",
    icon: <ShieldCheck className="w-4 h-4" />,
    color: "text-primary",
  },
  keyphrase_set: {
    label: "Keyphrase updated",
    icon: <KeyRound className="w-4 h-4" />,
    color: "text-blue-400",
  },
  keyphrase_verified: {
    label: "Keyphrase verified",
    icon: <KeyRound className="w-4 h-4" />,
    color: "text-blue-300",
  },
  device_registered: {
    label: "Device trusted",
    icon: <Smartphone className="w-4 h-4" />,
    color: "text-primary",
  },
  device_revoked: {
    label: "Device revoked",
    icon: <Smartphone className="w-4 h-4" />,
    color: "text-orange-400",
  },
  snapshot_created: {
    label: "Snapshot created",
    icon: <Archive className="w-4 h-4" />,
    color: "text-primary",
  },
  snapshot_restored: {
    label: "Snapshot restored",
    icon: <RotateCcw className="w-4 h-4" />,
    color: "text-yellow-400",
  },
  snapshot_deleted: {
    label: "Snapshot deleted",
    icon: <Trash2 className="w-4 h-4" />,
    color: "text-orange-400",
  },
  deletion_requested: {
    label: "Deletion requested",
    icon: <AlertTriangle className="w-4 h-4" />,
    color: "text-red-400",
  },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDetail(action: string, metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  if (action === "keyphrase_set") return metadata.updated ? "Keyphrase changed" : "Keyphrase created";
  if (action === "keyphrase_verified") return metadata.valid ? "Verification successful" : "Verification failed";
  if (action === "device_registered" && metadata.label) return `Label: ${metadata.label}`;
  if (action === "device_revoked" && metadata.label) return `Revoked: ${metadata.label}`;
  if (action === "snapshot_created" && metadata.label) return `"${metadata.label}"`;
  if (action === "deletion_requested" && metadata.targetType) return `Type: ${metadata.targetType}`;
  return null;
}

export function ActivityLog() {
  const { data: events, isLoading, error } = useGetAuditLog();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading activity log…
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive py-2">Failed to load activity log.</p>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <Activity className="w-8 h-8 opacity-40" />
        <p className="text-sm">No security events in the last 90 days.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
      {events.map((event) => {
        const meta = ACTION_META[event.action] ?? {
          label: event.action,
          icon: <ShieldCheck className="w-4 h-4" />,
          color: "text-muted-foreground",
        };
        const detail = getDetail(event.action, event.metadata as Record<string, unknown> | null | undefined);

        return (
          <div
            key={event.id}
            className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/30 transition-colors"
          >
            <span className={`mt-0.5 shrink-0 ${meta.color}`}>{meta.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-tight">{meta.label}</p>
              {detail && (
                <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
              )}
              {event.ip && (
                <p className="text-xs text-muted-foreground/60 mt-0.5 font-mono">{event.ip}</p>
              )}
            </div>
            <span className="text-xs text-muted-foreground/70 shrink-0 mt-0.5 whitespace-nowrap">
              {formatDate(event.createdAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
