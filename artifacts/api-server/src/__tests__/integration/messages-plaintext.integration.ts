import { createHash, randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/express";
import { db, messagesTable, threadsTable, profilesTable, settingsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Message = { id: number; threadId: number; role: string; content: string };
const prefix = "enc:v1:";
const plaintext = `Live encryption regression check ${randomUUID()} — café 日本語`;

let clerk: ReturnType<typeof createClerkClient>;
let userId: string | undefined;
let sessionId: string | undefined;
let threadId: number | undefined;
let saved: Message;
let apiBase: string;

// Do not log tokens, headers, response bodies, or Clerk errors (which may
// include request details). Report only the operation and HTTP status.
async function api(path: string, method = "GET", body?: unknown, authenticated = true) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authenticated) {
    const token = await clerk.sessions.getToken(sessionId!);
    headers.Authorization = `Bearer ${token.jwt}`;
  }
  return fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
}

function assertPlaintextMessages(value: unknown): asserts value is Message[] {
  expect(Array.isArray(value)).toBe(true);
  const rows = value as Message[];
  expect(rows.length).toBeGreaterThan(0); // Empty responses must not pass.
  for (const row of rows) {
    expect(typeof row.content).toBe("string");
    expect(row.content.startsWith(prefix), `Message ${row.id} leaked ciphertext`).toBe(false);
  }
  expect(rows.find((row) => row.id === saved.id)?.content).toBe(plaintext);
}

async function waitForApiReady(): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastStatus: number | undefined;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBase}/healthz`, {
        signal: AbortSignal.timeout(3_000),
        redirect: "error",
      });
      if (response.ok) return;
      lastStatus = response.status;
    } catch {
      // The preview proxy can briefly return 502 while the API process starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `API did not become ready at /healthz within 30 seconds` +
      (lastStatus === undefined ? "." : ` (last HTTP status: ${lastStatus}).`),
  );
}

describe("live API: encrypted messages are served as plaintext", () => {
  beforeAll(async () => {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey?.startsWith("sk_test_")) {
      throw new Error("Live integration tests require CLERK_SECRET_KEY for a development Clerk instance; live keys are refused.");
    }
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL must point to the same development database as the running API.");
    }
    const base = process.env.API_INTEGRATION_BASE_URL ??
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/api` : undefined);
    if (!base) throw new Error("Set API_INTEGRATION_BASE_URL to the running development API, including /api.");
    apiBase = base.replace(/\/$/, "");
    const url = new URL(apiBase);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("API_INTEGRATION_BASE_URL must be an HTTP(S) URL without credentials.");
    }
    clerk = createClerkClient({ secretKey });
    // Wait for the separate API workflow to finish starting before checking
    // that real authentication rejects unauthenticated requests.
    await waitForApiReady();
    const denied = await api("/messages/recent", "GET", undefined, false);
    expect(denied.status, "Unauthenticated recent messages request").toBe(401);

    try {
      const user = await clerk.users.createUser({
        emailAddress: [`messages-${randomUUID()}+clerk_test@example.com`],
        password: `${randomUUID()}aA!9`,
      });
      userId = user.id;
      const session = await clerk.sessions.createSession({ userId });
      sessionId = session.id;
    } catch {
      throw new Error("Could not create temporary Clerk development user/session. Check test-key access and Clerk availability.");
    }
    const created = await api("/threads", "POST", { title: "Live plaintext regression fixture" });
    expect(created.status, "Create thread").toBe(201);
    const thread = await created.json() as { id: number; userId: string };
    threadId = thread.id;
    expect(Number.isInteger(threadId)).toBe(true);
    expect(thread.userId).toBe(userId);

    const sent = await api(`/threads/${threadId}/messages`, "POST", { content: plaintext });
    expect(sent.status, "Send message").toBe(200);
    saved = await sent.json() as Message;
    expect(saved.content).toBe(plaintext);
    expect(saved.threadId).toBe(threadId);

    const [stored] = await db.select({ content: messagesTable.content })
      .from(messagesTable).where(and(eq(messagesTable.id, saved.id), eq(messagesTable.threadId, threadId!)));
    expect(stored, "Message must exist in the live server's database").toBeDefined();
    expect(stored!.content.startsWith(prefix), "Fixture must actually be encrypted at rest").toBe(true);
    expect(stored!.content).not.toBe(plaintext);
  });

  afterAll(async () => {
    // Only remove this run's newly-created user data; thread deletion cascades
    // to messages. Never use the protected user-facing deletion workflow.
    try {
      if (userId) {
        await db.delete(threadsTable).where(eq(threadsTable.userId, userId));
        await db.delete(profilesTable).where(eq(profilesTable.userId, userId));
        await db.delete(settingsTable).where(eq(settingsTable.userId, userId));
        await db.execute(sql`DELETE FROM oauth_authorization_codes WHERE user_id = ${userId}`);
      }
    } finally {
      try {
        if (sessionId) await clerk.sessions.revokeSession(sessionId);
      } finally {
        if (userId) await clerk.users.deleteUser(userId);
      }
    }
  });

  it("GET /api/threads/:id/messages returns no enc:v1: content", async () => {
    const denied = await api(`/threads/${threadId}/messages`, "GET", undefined, false);
    expect(denied.status).toBe(401);
    const response = await api(`/threads/${threadId}/messages`);
    expect(response.status, "Fetch thread messages").toBe(200);
    assertPlaintextMessages(await response.json());
  });

  it("GET /api/messages/recent returns no enc:v1: content", async () => {
    const response = await api("/messages/recent?limit=200");
    expect(response.status, "Fetch recent messages").toBe(200);
    assertPlaintextMessages(await response.json());
  });

  it("exchanges real signed-in Grok consent for working memory access without allowing replay", async () => {
    const verifier = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
    const authorization = {
      client_id: "https://grok.com/oauth/mcp-client.json",
      redirect_uri: "https://grok.com/connectors-oauth-exchange-code/",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: randomUUID(),
    };
    const denied = await api("/oauth/code", "POST", authorization, false);
    expect(denied.status, "Consent must require a real signed-in session").toBe(401);

    const approved = await api("/oauth/code", "POST", authorization);
    expect(approved.status, "Approve Grok consent with a real development session").toBe(200);
    const issued = await approved.json() as { code: string; state: string };
    expect(typeof issued.code === "string" && issued.code.length > 0).toBe(true);
    expect(issued.state).toBe(authorization.state);

    const exchange = {
      grant_type: "authorization_code",
      code: issued.code,
      code_verifier: verifier,
      client_id: authorization.client_id,
      redirect_uri: authorization.redirect_uri,
    };
    const exchanged = await api("/oauth/token", "POST", exchange, false);
    expect(exchanged.status, "Exchange code with PKCE").toBe(200);
    const credentials = await exchanged.json() as { access_token: string; token_type: string };
    // Never assert or log credential values; failures must not expose tokens.
    expect(typeof credentials.access_token === "string" && credentials.access_token.length > 0).toBe(true);
    expect(credentials.token_type).toBe("Bearer");

    const replay = await api("/oauth/token", "POST", exchange, false);
    expect(replay.status, "Authorization code must be single-use").toBe(400);

    const memory = await fetch(`${apiBase}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${credentials.access_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "get_conversation", arguments: { thread_id: threadId } },
      }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    expect(memory.status, "Read the fixture's saved memory using the exchanged token").toBe(200);
    const wire = await memory.text();
    const json = memory.headers.get("content-type")?.includes("text/event-stream")
      ? wire.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
      : wire;
    expect(typeof json === "string").toBe(true);
    const rpc = JSON.parse(json!) as {
      error?: unknown;
      result?: { isError?: boolean; content: { type: string; text?: string }[] };
    };
    expect(rpc.error).toBeUndefined();
    expect(rpc.result?.isError).not.toBe(true);
    const transcript = rpc.result?.content.map((part) => part.text ?? "").join("\n") ?? "";
    expect(transcript.includes(plaintext), "Connector must retrieve the real encrypted-at-rest fixture as plaintext").toBe(true);
    expect(transcript.includes(prefix)).toBe(false);

    // Trashed memories must disappear from direct-ID MCP reads as well as lists.
    if (threadId === undefined) throw new Error("Live regression fixture was not created.");
    await db.update(threadsTable).set({ deletedAt: new Date() })
      .where(eq(threadsTable.id, threadId));
    for (const name of ["get_conversation", "get_memory_summary"]) {
      const trashed = await fetch(`${apiBase}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${credentials.access_token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 2, method: "tools/call",
          params: { name, arguments: { thread_id: threadId } },
        }),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      expect(trashed.status).toBe(200);
      const body = await trashed.text();
      const payload = trashed.headers.get("content-type")?.includes("text/event-stream")
        ? body.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
        : body;
      expect(typeof payload === "string").toBe(true);
      const response = JSON.parse(payload!);
      expect(response.result?.isError, `${name} must not reveal a trashed memory`).toBe(true);
      expect(body.includes(plaintext)).toBe(false);
    }
  });

  it("routes the trash list correctly and restores only this run's fixture", async () => {
    const denied = await api("/threads/deleted", "GET", undefined, false);
    expect(denied.status).toBe(401);
    const listed = await api("/threads/deleted");
    expect(listed.status, "The literal trash route must not be parsed as a numeric thread ID").toBe(200);
    const trashed = await listed.json() as { id: number; userId: string }[];
    expect(trashed.some((thread) => thread.id === threadId)).toBe(true);
    expect(trashed.every((thread) => thread.userId === userId)).toBe(true);
    const restored = await api(`/threads/${threadId}/restore`, "PATCH", {});
    expect(restored.status).toBe(200);
    const visible = await api(`/threads/${threadId}`);
    expect(visible.status).toBe(200);
    const refreshed = await api("/threads/deleted");
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json() as { id: number }[]).some((thread) => thread.id === threadId)).toBe(false);
  });
});
