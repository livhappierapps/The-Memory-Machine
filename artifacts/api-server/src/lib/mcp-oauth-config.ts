// Public origin of this deployment. Used as the OAuth issuer / MCP resource
// origin and for links in emails.
//
// Set PUBLIC_ORIGIN (e.g. https://memorymachine.livhappierapps.com). On Render,
// RENDER_EXTERNAL_URL is used automatically when PUBLIC_ORIGIN is unset.
// REPLIT_DOMAINS is kept only as a legacy fallback.
function resolvePublicOrigin(): string {
  const configured =
    process.env.PUBLIC_ORIGIN?.trim() || process.env.RENDER_EXTERNAL_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const replit = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (replit) return `https://${replit}`;
  return "http://localhost:8080";
}

export const PUBLIC_ORIGIN = resolvePublicOrigin();
export const MCP_OAUTH_ORIGIN = PUBLIC_ORIGIN;
export const MCP_RESOURCE = `${MCP_OAUTH_ORIGIN}/api/mcp`;
export const MCP_RESOURCE_METADATA = `${MCP_OAUTH_ORIGIN}/.well-known/oauth-protected-resource/api/mcp`;
