import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PendingDeletion {
  id: number;
  status: string;
  targetType: string;
  dateFrom: string | null;
  dateTo: string | null;
  executeAfter: string;
}

function formatCountdown(targetDate: Date): string {
  const diff = targetDate.getTime() - Date.now();
  if (diff <= 0) return "executing soon...";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function targetLabel(request: PendingDeletion): string {
  if (request.targetType === "account") return "your entire account";
  if (request.targetType === "history") return "your full conversation history";
  if (request.dateFrom || request.dateTo) {
    const from = request.dateFrom ? new Date(request.dateFrom).toLocaleDateString() : "all time";
    const to = request.dateTo ? new Date(request.dateTo).toLocaleDateString() : "now";
    return `conversations from ${from} to ${to}`;
  }
  return "selected conversations";
}

export function DeletionWarningBanner() {
  const [pending, setPending] = useState<PendingDeletion | null>(null);
  const [countdown, setCountdown] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let mounted = true;
    const fetchPending = async () => {
      try {
        const res = await fetch("/api/deletion-requests/pending", {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (mounted) setPending(data);
        }
      } catch {
        /* silent */
      }
    };
    fetchPending();
    const poll = setInterval(fetchPending, 60_000);
    return () => {
      mounted = false;
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const target = new Date(pending.executeAfter);
    const tick = () => setCountdown(formatCountdown(target));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [pending]);

  const handleCancel = useCallback(async () => {
    if (!pending) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/deletion-requests/${pending.id}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setPending(null);
        toast({ title: "Deletion cancelled", description: "Your data is safe." });
      } else {
        toast({ title: "Failed to cancel", variant: "destructive" });
      }
    } finally {
      setCancelling(false);
    }
  }, [pending, toast]);

  if (!pending) return null;

  return (
    <div
      className="w-full cursor-pointer select-none"
      style={{
        background: "linear-gradient(90deg, #7f1d1d 0%, #991b1b 50%, #7f1d1d 100%)",
        borderBottom: "2px solid #ef4444",
        animation: "pulse 2s ease-in-out infinite",
      }}
      onClick={handleCancel}
    >
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
        <AlertTriangle className="w-5 h-5 text-red-300 shrink-0 animate-bounce" />
        <div className="flex-1 min-w-0">
          <span className="font-bold text-white text-sm">
            ⚠ DELETION PENDING
          </span>
          <span className="text-red-200 text-sm ml-2">
            {targetLabel(pending)} will be deleted in{" "}
          </span>
          <span
            className="font-mono font-bold text-sm"
            style={{ color: "#ff6b6b" }}
          >
            {countdown}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-white text-xs font-semibold bg-red-800 border border-red-500 px-3 py-1.5 rounded-full">
            TAP TO CANCEL
          </span>
          {cancelling && (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      </div>
    </div>
  );
}

interface PaymentWarningBannerProps {
  paymentStatus: string;
}

export function PaymentWarningBanner({ paymentStatus }: PaymentWarningBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (paymentStatus === "active" || dismissed) return null;

  return (
    <div
      className="w-full"
      style={{
        background: "linear-gradient(90deg, #78350f 0%, #92400e 50%, #78350f 100%)",
        borderBottom: "2px solid #f97316",
      }}
    >
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-orange-300 shrink-0" />
        <p className="flex-1 text-orange-100 text-sm font-medium">
          ⚠ Your account has an outstanding payment. Some features may be limited soon.
        </p>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-orange-300 hover:text-white transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
