import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { once } from "node:events";

const factory = vi.hoisted(() => vi.fn((_options: unknown) => (_req: unknown, _res: unknown, next: () => void) => next()));
vi.mock("http-proxy-middleware", () => ({ createProxyMiddleware: factory }));
import { clerkProxyMiddleware, getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";

type Headers = Record<string, string | string[] | undefined>;
class Upstream extends PassThrough {
  headers: Headers = { "transfer-encoding": "chunked", connection: "keep-alive" };
  statusCode = 200;
}
function makeResponse() {
  const res = new PassThrough();
  return Object.assign(res, { writeHead: vi.fn(), headersSent: false });
}

function responseHandler() {
  // Synthetic test configuration only; never use or expose a real credential.
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CLERK_SECRET_KEY", "fixture-not-a-real-clerk-secret");
  clerkProxyMiddleware();
  const options = factory.mock.calls.at(-1)![0] as {
    selfHandleResponse: boolean;
    on: { proxyRes: (upstream: Upstream, req: { method: string }, res: ReturnType<typeof makeResponse>) => void };
  };
  expect(options.selfHandleResponse).toBe(true);
  return options.on.proxyRes;
}

afterEach(() => {
  vi.unstubAllEnvs();
  factory.mockClear();
});

describe("Clerk proxy response framing", () => {
  it("buffers dynamic JSON with an explicit byte length and preserves session cookies", async () => {
    const handler = responseHandler();
    const upstream = new Upstream();
    const cookies = ["__session=fixture; Secure; HttpOnly", "other=fixture; Secure"];
    upstream.headers["set-cookie"] = cookies;
    const res = makeResponse();
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    handler(upstream, { method: "GET" }, res);
    const finished = once(res, "finish");
    upstream.end(Buffer.from('{"ok":"✓"}'));
    await finished;
    const body = Buffer.concat(chunks);
    expect(body.toString()).toBe('{"ok":"✓"}');
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "set-cookie": cookies, "content-length": String(body.length),
    });
  });

  it("pipes responses that already have a content length", async () => {
    const handler = responseHandler();
    const upstream = new Upstream();
    upstream.headers["content-length"] = "2";
    const res = makeResponse();
    res.resume();
    handler(upstream, { method: "GET" }, res);
    const finished = once(res, "finish");
    upstream.end("ok");
    await finished;
    expect(res.writeHead).toHaveBeenCalledWith(200, { "content-length": "2" });
  });

  it("returns a length-framed 502 when the upstream fails before headers", async () => {
    const handler = responseHandler();
    const upstream = new Upstream();
    const res = makeResponse();
    res.resume();
    handler(upstream, { method: "GET" }, res);
    const finished = once(res, "finish");
    upstream.emit("error", new Error("fixture upstream failure"));
    await finished;
    expect(res.writeHead).toHaveBeenCalledWith(502, { "content-length": "0" });
  });

  it("uses the same first forwarded host as the authentication middleware", () => {
    expect(getClerkProxyHost({ headers: {
      "x-forwarded-host": "memory.example, proxy.internal", host: "localhost",
    } })).toBe("memory.example");
  });
});
