import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2, Shield, Lock, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type DeletionStep = "confirm" | "otp" | "keyphrase-entry" | "waiting" | "device-challenge" | "device-otp";

interface DeletionFlowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId?: number;
  targetType: "thread" | "date-range" | "history" | "account";
  targetIds?: number[];
  dateFrom?: string;
  dateTo?: string;
  onSuccess?: () => void;
}

export function DeletionFlowDialog({
  open,
  onOpenChange,
  targetType,
  targetIds,
  dateFrom,
  dateTo,
  onSuccess,
}: DeletionFlowDialogProps) {
  const [step, setStep] = useState<DeletionStep>("confirm");
  const [otp, setOtp] = useState("");
  const [keyphrase, setKeyphrase] = useState("");
  const [requestId, setRequestId] = useState<number | null>(null);
  const [executeAfter, setExecuteAfter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [deviceOtp, setDeviceOtp] = useState("");
  const { toast } = useToast();

  const waitLabel = targetType === "history" || targetType === "account" ? "2 weeks" : "24 hours";

  const targetLabel =
    targetType === "account"
      ? "your entire account"
      : targetType === "history"
        ? "your full conversation history"
        : targetType === "date-range"
          ? `conversations from ${dateFrom ?? "start"} to ${dateTo ?? "now"}`
          : "this conversation";

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/deletion-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetType, targetIds, dateFrom, dateTo }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403 && data.error === "device_challenge_required") {
          setStep("device-challenge");
          return;
        }
        if (data.error === "two_factor_required") {
          setError("You must enable two-factor authentication on your account before deleting data. Go to your account settings to enable it.");
        } else if (data.error === "recency_lock") {
          setError(data.message);
        } else {
          setError(data.error ?? "Failed to initiate deletion request");
        }
        return;
      }
      setRequestId(data.id);
      setStep("otp");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeviceChallenge = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/security/devices/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ label: "Vault Browser" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to send verification code");
        return;
      }
      setDeviceToken(data.deviceToken);
      setStep("device-otp");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeviceVerify = async () => {
    if (!deviceToken || !deviceOtp) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/security/devices/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deviceToken, otp: deviceOtp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Invalid verification code");
        return;
      }
      setDeviceOtp("");
      setDeviceToken(null);
      toast({
        title: "Device verified",
        description: "This device is now trusted. Please confirm your deletion request.",
      });
      setStep("confirm");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtp = async () => {
    if (!requestId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deletion-requests/${requestId}/confirm-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ otp, keyphrase: keyphrase || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "keyphrase_required") {
          setStep("keyphrase-entry");
          setError("Please enter your keyphrase to continue.");
        } else {
          setError(data.error ?? "Invalid code");
        }
        return;
      }
      setExecuteAfter(data.executeAfter);
      toast({
        title: "Deletion request confirmed",
        description: `Your data will be deleted after ${waitLabel}. You'll receive a link by email to complete the process. A warning banner will appear in the app — click it at any time to cancel.`,
      });
      setStep("waiting");
      onSuccess?.();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyphraseOtp = async () => {
    if (!requestId || !keyphrase) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deletion-requests/${requestId}/confirm-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ otp, keyphrase }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Invalid keyphrase");
        return;
      }
      setExecuteAfter(data.executeAfter);
      toast({
        title: "Deletion request confirmed",
        description: `Your data will be deleted after ${waitLabel}. Check your email for the final deletion link.`,
      });
      setStep("waiting");
      onSuccess?.();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (step === "waiting") {
      setStep("confirm");
      setOtp("");
      setKeyphrase("");
      setRequestId(null);
      setError(null);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md border-red-900/50 bg-card">
        {step === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="w-5 h-5" />
                Delete {targetLabel}?
              </DialogTitle>
              <DialogDescription className="text-muted-foreground space-y-2 pt-1">
                <p>
                  This is a <strong className="text-foreground">protected deletion</strong>. After confirming:
                </p>
                <ul className="list-disc pl-4 space-y-1 text-sm">
                  <li>A verification code is sent to your email</li>
                  <li>A <strong className="text-red-400">{waitLabel}</strong> waiting period begins</li>
                  <li>A warning banner appears — click it to cancel at any time</li>
                  <li>After the wait, you receive a final deletion link by email</li>
                </ul>
                {(targetType === "history" || targetType === "account") && (
                  <div className="mt-3 p-3 bg-red-950/50 border border-red-800 rounded-lg text-red-200 text-sm">
                    <Shield className="w-4 h-4 inline mr-1.5" />
                    This is permanent and cannot be undone. Even we cannot recover your data.
                  </div>
                )}
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-red-400 bg-red-950/30 p-3 rounded-lg">{error}</p>}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirm}
                disabled={loading}
                className="bg-red-700 hover:bg-red-600"
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Start Deletion Process
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "device-challenge" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-primary" />
                Verify this device first
              </DialogTitle>
              <DialogDescription className="space-y-2 pt-1">
                <p>
                  Deletion requests require a <strong className="text-foreground">trusted device</strong>. This browser hasn't been verified yet.
                </p>
                <p className="text-sm">
                  Click below to send a verification code to your email. Once verified, this device will be trusted for 90 days.
                </p>
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-red-400 bg-red-950/30 p-3 rounded-lg">{error}</p>}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleDeviceChallenge} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Smartphone className="w-4 h-4 mr-2" />}
                Send Verification Code
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "device-otp" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-primary" />
                Verify your device
              </DialogTitle>
              <DialogDescription>
                A 6-digit code was sent to your email. Enter it below to trust this device, then your deletion request will proceed.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={deviceOtp}
                onChange={(e) => setDeviceOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="text-center text-2xl font-mono tracking-widest h-14"
                autoFocus
              />
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setStep("device-challenge"); setError(null); }} disabled={loading}>
                Back
              </Button>
              <Button onClick={handleDeviceVerify} disabled={loading || deviceOtp.length !== 6}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Verify Device
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "otp" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Enter verification code
              </DialogTitle>
              <DialogDescription>
                A 6-digit code was sent to your email address. Enter it below to confirm your identity. The code expires in 15 minutes.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="text-center text-2xl font-mono tracking-widest h-14"
                autoFocus
              />
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleOtp} disabled={loading || otp.length !== 6}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Confirm
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "keyphrase-entry" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-primary" />
                Enter your keyphrase
              </DialogTitle>
              <DialogDescription>
                Your account has a keyphrase set up. Enter it along with your verification code to proceed.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="Verification code (6 digits)"
                maxLength={6}
                className="text-center font-mono tracking-widest"
              />
              <Input
                type="password"
                value={keyphrase}
                onChange={(e) => setKeyphrase(e.target.value)}
                placeholder="Your keyphrase"
                autoFocus
              />
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleKeyphraseOtp} disabled={loading || otp.length !== 6 || !keyphrase}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Confirm with Keyphrase
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "waiting" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-primary">Deletion request active</DialogTitle>
              <DialogDescription className="space-y-2 pt-1">
                <p>
                  Your deletion request is confirmed. A <strong className="text-red-400">{waitLabel}</strong> waiting period has begun.
                </p>
                <p>
                  A <strong className="text-red-400">warning banner</strong> will appear at the top of the app — <strong>click it at any time to cancel</strong>.
                </p>
                <p>
                  After the waiting period, you'll receive a final deletion link by email with one more verification step.
                </p>
                {executeAfter && (
                  <p className="text-xs text-muted-foreground">
                    Scheduled for: {new Date(executeAfter).toLocaleString()}
                  </p>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={handleClose}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
