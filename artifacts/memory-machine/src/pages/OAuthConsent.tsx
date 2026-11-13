/**
 * OAuthConsent.tsx — OAuth 2.0 consent screen.
 *
 * Grok (and other MCP clients) redirect the user here as part of the OAuth
 * Authorization Code + PKCE flow. The user must be signed in to Memory Machine.
 * On approval, we POST to /api/oauth/code and redirect back to Grok with the code.
 */

import { useState } from "react";
import { useAuth } from "@clerk/react";
import { Brain, ShieldCheck, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { basePath } from "@/lib/clerk-config";

const TRUSTED_CALLBACK_DOMAINS = ["grok.com", "x.ai"] as const;

function isAllowedOAuthRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const trustedDomain = TRUSTED_CALLBACK_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
    const developmentLoopback =
      import.meta.env.DEV && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      ((url.protocol === "https:" && (trustedDomain || developmentLoopback)) ||
        (url.protocol === "http:" && developmentLoopback))
    );
  } catch {
    return false;
  }
}

function parseParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    clientId: p.get("client_id") ?? "",
    redirectUri: p.get("redirect_uri") ?? "",
    codeChallenge: p.get("code_challenge") ?? "",
    codeChallengeMethod: p.get("code_challenge_method") ?? "S256",
    state: p.get("state") ?? "",
    responseType: p.get("response_type") ?? "code",
  };
}

export default function OAuthConsent() {
  const { isLoaded, isSignedIn } = useAuth();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const params = parseParams();
  const requestIsValid =
    Boolean(params.clientId) &&
    params.clientId.length <= 2048 &&
    isAllowedOAuthRedirectUri(params.redirectUri) &&
    /^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge) &&
    params.codeChallengeMethod === "S256" &&
    params.responseType === "code" &&
    params.state.length <= 1024;

  // Redirect to sign-in if not authenticated, preserving the full consent URL
  const signInUrl = `${basePath}/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`;

  async function handleAllow() {
    if (status === "loading") return;
    if (!requestIsValid) {
      setErrorMsg("Missing required OAuth parameters. Please return to Grok and try again.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/oauth/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          client_id: params.clientId,
          redirect_uri: params.redirectUri,
          code_challenge: params.codeChallenge,
          code_challenge_method: params.codeChallengeMethod,
          state: params.state,
        }),
      });

      if (res.status === 401) {
        setErrorMsg("Memory Machine could not verify your sign-in. Sign in again below, then approve the connection. Your connector settings have not changed.");
        setStatus("error");
        return;
      }
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const { code, state } = await res.json() as { code: string; state: string };

      // Build redirect URL back to Grok
      const redirectUrl = new URL(params.redirectUri);
      redirectUrl.searchParams.set("code", code);
      if (state) redirectUrl.searchParams.set("state", state);

      window.location.href = redirectUrl.toString();
    } catch (err) {
      setErrorMsg("Something went wrong. Please go back to Grok and try connecting again.");
      setStatus("error");
    }
  }

  function handleDeny() {
    if (!requestIsValid) return;
    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set("error", "access_denied");
    if (params.state) redirectUrl.searchParams.set("state", params.state);
    window.location.href = redirectUrl.toString();
  }

  if (!isLoaded) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!requestIsValid) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-3 text-center">
          <h1 className="text-xl font-semibold text-destructive">Invalid connection request</h1>
          <p className="text-sm text-muted-foreground">
            This OAuth request has an unsupported callback or invalid security parameters. Return to Grok and try connecting again.
          </p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-4">
          <div className="text-center space-y-2 pb-4">
            <Brain className="w-10 h-10 text-primary mx-auto" />
            <h1 className="text-xl font-semibold">Sign in first</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to Memory Machine to connect it to Grok.
            </p>
          </div>
          <Button asChild className="w-full">
            <a href={signInUrl}>Sign in to Memory Machine</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Brain className="w-7 h-7 text-primary" />
            </div>
          </div>
          <div>
            <h1 className="text-xl font-semibold">Connect Grok to your vault</h1>
            <p className="text-sm text-muted-foreground mt-1">
              <strong className="text-foreground">{params.clientId}</strong> wants to access Leo's memories in your Memory Machine vault.
            </p>
          </div>
        </div>

        {/* What Grok can do */}
        <div className="bg-card border border-border/50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">What Grok will be able to do</p>
          <ul className="space-y-2">
            {[
              "Search Leo's memories by topic or date",
              "Read past conversations stored in your vault",
              "Save new memories during a conversation",
              "See pinned and recent memories",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-foreground/80">
                <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Privacy note */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Grok only gets access to YOUR vault. You can disconnect it any time by resetting your token in Memory Machine settings.</span>
        </div>

        {/* Error */}
        {status === "error" && (
          <div role="alert" className="space-y-3 text-center">
            <p className="text-sm text-destructive">{errorMsg}</p>
            <a href={signInUrl} className="text-sm text-primary underline">
              Sign in again
            </a>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleDeny}
            disabled={status === "loading"}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleAllow}
            disabled={status === "loading"}
          >
            {status === "loading" ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Connecting…
              </span>
            ) : (
              "Allow"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
