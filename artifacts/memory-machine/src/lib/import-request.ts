export function makeImportRequestInit(
  body: BodyInit,
  signal: AbortSignal,
  contentType?: "application/json",
  authToken?: string | null,
): RequestInit {
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  return {
    method: "POST",
    body,
    credentials: "include",
    headers: Object.keys(headers).length ? headers : undefined,
    signal,
  };
}

const SIGN_IN_RECOVERY_MESSAGE =
  "Memory Machine couldn't confirm your sign-in. Refresh the page, sign in again if asked, and retry. No memories were imported.";

export function requireImportAuthToken(token: string | null | undefined): string {
  if (!token?.trim()) {
    throw new Error(SIGN_IN_RECOVERY_MESSAGE);
  }
  return token;
}

export function getImportRequestError(
  status: number,
  serverMessage: string | undefined,
  fallback: string,
): string {
  if (status === 401) {
    return SIGN_IN_RECOVERY_MESSAGE;
  }
  return serverMessage ?? fallback;
}
