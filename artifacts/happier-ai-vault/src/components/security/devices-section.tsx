import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Smartphone, Plus, Trash2, ShieldCheck, CheckCircle } from "lucide-react";

interface TrustedDevice {
  id: number;
  label: string;
  firstSeen: string;
  lastSeen: string;
  expiresAt: string;
}

type FlowStep = "idle" | "labeling" | "challenging" | "verifying" | "done";

export function DevicesSection() {
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [fetching, setFetching] = useState(true);
  const [step, setStep] = useState<FlowStep>("idle");
  const [label, setLabel] = useState("My Device");
  const [deviceToken, setDeviceToken] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpInline, setOtpInline] = useState("");
  const [otp, setOtp] = useState("");
  const [revoking, setRevoking] = useState<number | null>(null);
  const { toast } = useToast();

  const loadDevices = async () => {
    try {
      const res = await fetch("/api/security/devices", { credentials: "include" });
      if (res.ok) setDevices(await res.json());
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => { loadDevices(); }, []);

  const handleChallenge = async () => {
    setStep("challenging");
    try {
      const res = await fetch("/api/security/devices/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ label }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error ?? "Failed to start challenge", variant: "destructive" });
        setStep("labeling");
        return;
      }
      setDeviceToken(data.deviceToken);
      setOtpSent(data.sent);
      if (!data.sent && data.otp) setOtpInline(data.otp);
      setStep("verifying");
    } catch {
      toast({ title: "Network error", description: "Could not reach the server.", variant: "destructive" });
      setStep("labeling");
    }
  };

  const handleVerify = async () => {
    setStep("challenging");
    try {
      const res = await fetch("/api/security/devices/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ otp, label, deviceToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Invalid code", description: data.error ?? "Verification failed", variant: "destructive" });
        setStep("verifying");
        return;
      }
      toast({ title: "Device trusted", description: `${label} is now trusted for 90 days.` });
      setStep("idle");
      setLabel("My Device");
      setOtp("");
      setOtpInline("");
      setDeviceToken("");
      setFetching(true);
      loadDevices();
    } catch {
      toast({ title: "Network error", description: "Could not reach the server.", variant: "destructive" });
      setStep("verifying");
    }
  };

  const handleRevoke = async (id: number) => {
    setRevoking(id);
    try {
      const res = await fetch(`/api/security/devices/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setDevices((d) => d.filter((x) => x.id !== id));
        toast({ title: "Device revoked" });
      } else {
        toast({ title: "Error", description: "Could not revoke device", variant: "destructive" });
      }
    } finally {
      setRevoking(null);
    }
  };

  const cancel = () => {
    setStep("idle");
    setLabel("My Device");
    setOtp("");
    setOtpInline("");
    setDeviceToken("");
  };

  if (fetching) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {devices.length === 0 && step === "idle" && (
        <p className="text-sm text-muted-foreground">No trusted devices yet.</p>
      )}

      {devices.length > 0 && (
        <div className="space-y-2">
          {devices.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between rounded-lg border border-border/50 bg-background px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Smartphone className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{d.label}</p>
                  <p className="text-xs text-muted-foreground">
                    Last seen {new Date(d.lastSeen).toLocaleDateString()} · expires {new Date(d.expiresAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleRevoke(d.id)}
                disabled={revoking === d.id}
                className="ml-3 p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                title="Revoke device"
              >
                {revoking === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            </div>
          ))}
        </div>
      )}

      {step === "idle" && (
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setStep("labeling")}
        >
          <Plus className="w-4 h-4" />
          Trust This Device
        </Button>
      )}

      {step === "labeling" && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
          <p className="text-sm font-medium">Name this device</p>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. MacBook, iPhone, Work PC"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleChallenge} disabled={!label.trim()} className="gap-2">
              Send Code
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
          </div>
        </div>
      )}

      {step === "challenging" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Sending verification code…
        </div>
      )}

      {step === "verifying" && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
          {otpSent ? (
            <p className="text-sm">We sent a 6-digit code to your email. Enter it below to trust this device.</p>
          ) : (
            <div className="flex items-center gap-2 p-2 bg-amber-950/40 border border-amber-700/50 rounded text-amber-200 text-sm">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>No email configured — your code is: <strong className="font-mono">{otpInline}</strong></span>
            </div>
          )}
          <Input
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="6-digit code"
            maxLength={6}
            inputMode="numeric"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleVerify} disabled={otp.length !== 6} className="gap-2">
              <CheckCircle className="w-4 h-4" />
              Verify
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
