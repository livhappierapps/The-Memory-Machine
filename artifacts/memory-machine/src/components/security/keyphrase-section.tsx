import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Lock, ShieldCheck, Loader2 } from "lucide-react";

interface KeyphraseStatus {
  hasKeyphrase: boolean;
  mfaEnabled: boolean;
  createdAt: string | null;
}

export function KeyphraseSection() {
  const [status, setStatus] = useState<KeyphraseStatus | null>(null);
  const [keyphrase, setKeyphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/security/keyphrase", { credentials: "include" });
        if (res.ok) setStatus(await res.json());
      } finally {
        setFetching(false);
      }
    };
    fetchStatus();
  }, []);

  const handleSave = async () => {
    if (keyphrase !== confirm) {
      toast({ title: "Keyphrases don't match", variant: "destructive" });
      return;
    }
    if (keyphrase.length < 6) {
      toast({ title: "Keyphrase too short", description: "Must be at least 6 characters.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/security/keyphrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ keyphrase }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "two_factor_required") {
          toast({
            title: "2FA required",
            description: "Enable two-factor authentication in your account settings before setting a keyphrase.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Error", description: data.error, variant: "destructive" });
        }
        return;
      }
      toast({
        title: status?.hasKeyphrase ? "Keyphrase updated" : "Keyphrase set",
        description: "Your deletion keyphrase has been saved.",
      });
      setStatus((s) => ({ ...(s ?? { mfaEnabled: true, createdAt: null }), hasKeyphrase: true, createdAt: new Date().toISOString() }));
      setKeyphrase("");
      setConfirm("");
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/20 rounded-lg text-sm text-foreground/80 leading-relaxed">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-foreground mb-1">About your keyphrase</p>
          <p>
            Your keyphrase is stored encrypted. The developer of this app can retrieve your keyphrase if you contact them directly
            (e.g. if you forget it), but <strong>cannot access your conversation data — ever</strong>. If your data is tampered with
            by any party, including the developer, it cannot be restored from our end. Snapshots (see Security settings when available)
            are your recovery tool.
          </p>
        </div>
      </div>

      {!status?.mfaEnabled && (
        <div className="p-4 bg-amber-950/40 border border-amber-700/50 rounded-lg text-amber-200 text-sm">
          <strong>Two-factor authentication is required</strong> before you can set a keyphrase. Enable it in your{" "}
          <a href="https://accounts.clerk.dev" target="_blank" rel="noreferrer" className="underline text-amber-100">
            account security settings
          </a>
          .
        </div>
      )}

      {status?.hasKeyphrase && (
        <div className="p-3 bg-primary/10 border border-primary/30 rounded-lg text-sm text-primary flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          Keyphrase set{status.createdAt ? ` on ${new Date(status.createdAt).toLocaleDateString()}` : ""}. Enter a new one below to update it.
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium text-foreground/80 mb-1.5 block">
            {status?.hasKeyphrase ? "New keyphrase" : "Keyphrase"}
          </label>
          <Input
            type="password"
            value={keyphrase}
            onChange={(e) => setKeyphrase(e.target.value)}
            placeholder="Enter a memorable phrase (6+ characters)"
            disabled={!status?.mfaEnabled}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground/80 mb-1.5 block">Confirm keyphrase</label>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your keyphrase"
            disabled={!status?.mfaEnabled}
          />
        </div>
        <Button
          onClick={handleSave}
          disabled={loading || !status?.mfaEnabled || !keyphrase}
          className="gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
          {status?.hasKeyphrase ? "Update Keyphrase" : "Save Keyphrase"}
        </Button>
      </div>
    </div>
  );
}
