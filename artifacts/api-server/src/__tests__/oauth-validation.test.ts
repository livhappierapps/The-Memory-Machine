import { describe, expect, it } from "vitest";
import { isAllowedOAuthRedirectUri, isValidPkceChallenge } from "../lib/oauth-validation.js";

describe("OAuth request validation", () => {
  it("accepts HTTPS callbacks owned by Grok and xAI", () => {
    expect(isAllowedOAuthRedirectUri("https://grok.com/oauth/callback")).toBe(true);
    expect(isAllowedOAuthRedirectUri("https://client.grok.com/oauth/callback")).toBe(true);
    expect(isAllowedOAuthRedirectUri("https://accounts.x.ai/oauth/callback")).toBe(true);
  });

  it("rejects untrusted, non-HTTPS, and URL-confusion callbacks", () => {
    expect(isAllowedOAuthRedirectUri("https://attacker.example/callback")).toBe(false);
    expect(isAllowedOAuthRedirectUri("https://grok.com.attacker.example/callback")).toBe(false);
    expect(isAllowedOAuthRedirectUri("https://grok.com@attacker.example/callback")).toBe(false);
    expect(isAllowedOAuthRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedOAuthRedirectUri("https://grok.com/callback#fragment")).toBe(false);
    expect(isAllowedOAuthRedirectUri("http://grok.com/callback")).toBe(false);
  });

  it("accepts only S256-sized base64url challenges", () => {
    expect(isValidPkceChallenge("A".repeat(43))).toBe(true);
    expect(isValidPkceChallenge("A".repeat(42))).toBe(false);
    expect(isValidPkceChallenge("A".repeat(44))).toBe(false);
    expect(isValidPkceChallenge("!".repeat(43))).toBe(false);
  });
});
