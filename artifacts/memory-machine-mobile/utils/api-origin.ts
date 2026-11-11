/**
 * Build profiles historically supplied both bare hosts and full HTTPS URLs.
 * Normalize once rather than producing URLs such as https://https://host.
 */
export function resolveApiOrigin(domain: string | undefined): string {
  const value = domain?.trim();
  if (!value) throw new Error("Memory Machine API address is missing from this build.");
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("Memory Machine API address must be an HTTPS origin.");
  }
  return url.origin;
}
