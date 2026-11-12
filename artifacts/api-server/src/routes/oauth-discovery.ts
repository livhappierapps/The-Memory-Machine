import { Router } from "express";
import { MCP_OAUTH_ORIGIN, MCP_RESOURCE } from "../lib/mcp-oauth-config";

const router = Router();
const scopes = ["memories:read", "memories:write"];

router.use("/.well-known", (_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  next();
});

router.get([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/api/mcp",
], (_req, res) => {
  res.json({
    resource: MCP_RESOURCE,
    resource_name: "The Memory Machine",
    authorization_servers: [MCP_OAUTH_ORIGIN],
    scopes_supported: scopes,
    bearer_methods_supported: ["header"],
  });
});

router.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json({
    issuer: MCP_OAUTH_ORIGIN,
    authorization_endpoint: `${MCP_OAUTH_ORIGIN}/api/oauth/authorize`,
    token_endpoint: `${MCP_OAUTH_ORIGIN}/api/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: scopes,
    client_id_metadata_document_supported: true,
  });
});

export default router;
