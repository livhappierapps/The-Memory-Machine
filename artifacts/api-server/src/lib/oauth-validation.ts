const TRUSTED_CALLBACK_DOMAINS = ["grok.com", "x.ai"] as const;
const DEVELOPMENT_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isAllowedOAuthRedirectUri(value: string): boolean {
  if (!value || value.length > 2048) return false;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const trustedDomain = TRUSTED_CALLBACK_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
    const developmentLoopback =
      process.env.NODE_ENV !== "production" && DEVELOPMENT_LOOPBACK_HOSTS.has(hostname);

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

export function isValidPkceChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Grok's URL-form client IDs must prove ownership of their callback metadata. */
export async function isAllowedOAuthClient(clientId: string, redirectUri: string): Promise<boolean> {
  try {
    const url = new URL(clientId);
    const trustedHost = TRUSTED_CALLBACK_DOMAINS.some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    );
    // Metadata fetches must never use development loopbacks or alternate ports.
    if (!isAllowedOAuthRedirectUri(clientId) || url.protocol !== "https:" || url.port || !trustedHost) return false;
    const response = await fetch(clientId, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const text = await response.text();
    if (text.length > 65536) return false;
    const metadata = JSON.parse(text);
    return metadata.client_id === clientId &&
      Array.isArray(metadata.redirect_uris) &&
      metadata.redirect_uris.includes(redirectUri) &&
      (!metadata.token_endpoint_auth_method || metadata.token_endpoint_auth_method === "none");
  } catch {
    return false;
  }
}
