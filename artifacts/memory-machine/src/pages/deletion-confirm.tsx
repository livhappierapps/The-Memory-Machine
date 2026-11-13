import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { Loader2, ShieldAlert, CheckCircle, XCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Phase = "loading" | "sign_in_required" | "otp_input" | "keyphrase_input" | "executing" | "done" | "error";

export default function DeletionConfirmPage() {
  const [, setLocation] = useLocation();
  const { isSignedIn, isLoaded, getToken } = useAuth();

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const token = params.get("token");

  const [phase, setPhase] = useState<Phase>("loading");
  const [otp, setOtp] = useState("");
  const [keyphrase, setKeyphrase] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [requestId, setRequestId] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setPhase("sign_in_required");
      return;
    }
    if (!id || !token) {
      setPhase("error");
      setErrorMsg("Invalid deletion link — missing id or token.");
      return;
    }
    activateLink();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  async function activateLink() {
    setPhase("loading");
    try {
      const res = await fetch(
        `/api/deletion-requests/${id}/execute-link?token=${encodeURIComponent(token!)}`,
      );
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        setPhase("error");
        setErrorMsg(
          typeof data.message === "string"
            ? data.message
            : `Error ${res.status}: ${String(data.error ?? "Unknown error")}`,
        );
        return;
      }
      setRequestId(parseInt(id!, 10));
      setPhase("otp_input");
    } catch {
      setPhase("error");
      setErrorMsg("Network error. Please try again.");
    }
  }

  async function submitOtp(kp?: string) {
    if (!otp.trim() || !requestId) return;
    setPhase("executing");
    setErrorMsg("");
    try {
      const clerkToken = await getToken();
      const body: Record<string, string> = { otp };
      if (kp) body.keyphrase = kp;
      const res = await fetch(`/api/deletion-requests/${requestId}/execute-final`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${clerkToken ?? ""}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        if (data.error === "keyphrase_required") {
          setPhase("keyphrase_input");
          setErrorMsg("");
        } else if (data.error === "expired_otp") {
          setPhase("error");
          setErrorMsg(typeof data.message === "string" ? data.message : "The code has expired. Please start a new deletion request.");
        } else {
          setPhase("otp_input");
          setErrorMsg(typeof data.error === "string" ? data.error : "Verification failed. Check the code and try again.");
        }
        return;
      }
      setPhase("done");
    } catch {
      setPhase("otp_input");
      setErrorMsg("Network error. Please try again.");
    }
  }

  if (phase === "loading") {
    return (
      <PageShell>
        <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
        <p className="text-muted-foreground">Validating your deletion link…</p>
      </PageShell>
    );
  }

  if (phase === "sign_in_required") {
    return (
      <PageShell>
        <ShieldAlert className="w-10 h-10 text-yellow-400 mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">Sign in required</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          You must sign in to complete the deletion. After signing in you will be redirected back here automatically.
        </p>
        <Button
          className="bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => setLocation(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`)}
        >
          Sign in
        </Button>
      </PageShell>
    );
  }

  if (phase === "error") {
    return (
      <PageShell>
        <XCircle className="w-10 h-10 text-destructive mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">Link invalid or expired</h2>
        <p className="text-muted-foreground mb-6 text-sm">{errorMsg}</p>
        <Button variant="outline" onClick={() => setLocation("/vault")}>Back to Vault</Button>
      </PageShell>
    );
  }

  if (phase === "done") {
    return (
      <PageShell>
        <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">Deletion complete</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          Your data has been permanently deleted.
        </p>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setLocation("/vault")}>
          Go to Vault
        </Button>
      </PageShell>
    );
  }

  if (phase === "keyphrase_input") {
    return (
      <PageShell>
        <Lock className="w-10 h-10 text-primary mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">Enter your keyphrase</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          Your account is protected by a keyphrase. Enter it below to complete the deletion.
        </p>
        {errorMsg && <p className="text-destructive text-sm mb-3">{errorMsg}</p>}
        <Input
          type="password"
          value={keyphrase}
          onChange={(e) => setKeyphrase(e.target.value)}
          placeholder="Your keyphrase"
          className="mb-4"
          onKeyDown={(e) => { if (e.key === "Enter") void submitOtp(keyphrase); }}
          autoFocus
        />
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={() => setLocation("/vault")}>Cancel</Button>
          <Button
            disabled={keyphrase.trim().length === 0}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() => void submitOtp(keyphrase)}
          >
            Verify & Delete
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <ShieldAlert className="w-10 h-10 text-destructive mx-auto mb-4" />
      <h2 className="text-lg font-semibold mb-2">Final confirmation</h2>
      <p className="text-muted-foreground mb-1 text-sm">
        A one-time verification code has been sent to your email address.
      </p>
      <p className="text-muted-foreground mb-6 text-sm">
        Enter it below to permanently execute the deletion. <strong className="text-foreground">This cannot be undone.</strong>
      </p>
      {errorMsg && (
        <p className="text-destructive text-sm mb-3">{errorMsg}</p>
      )}
      <Input
        value={otp}
        onChange={(e) => setOtp(e.target.value)}
        placeholder="6-digit code"
        maxLength={6}
        className="text-center text-lg tracking-widest mb-4 w-40 mx-auto"
        onKeyDown={(e) => { if (e.key === "Enter") void submitOtp(); }}
        autoFocus
      />
      <div className="flex gap-3 justify-center">
        <Button variant="outline" onClick={() => setLocation("/vault")}>Cancel</Button>
        <Button
          disabled={phase === "executing" || otp.trim().length < 6}
          className="bg-destructive text-white hover:bg-destructive/90"
          onClick={() => void submitOtp()}
        >
          {phase === "executing" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Permanently delete
        </Button>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-card border border-border rounded-xl p-8 text-center shadow-xl">
        {children}
      </div>
    </div>
  );
}
