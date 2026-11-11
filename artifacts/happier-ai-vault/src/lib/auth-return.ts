/**
 * Only resume the local consent screen after sign-in. Never forward a
 * caller-supplied external URL through Clerk's forced redirect.
 */
export function getConsentReturnUrl(
  search: string,
  origin: string,
  basePath: string,
): string | undefined {
  const candidate = new URLSearchParams(search).get("redirect_url");
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate, origin);
    if (
      url.origin !== origin ||
      url.pathname !== `${basePath}/oauth/authorize` ||
      url.username ||
      url.password
    ) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
