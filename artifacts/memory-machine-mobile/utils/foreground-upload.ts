/** HTTP errors must not all be retried (especially auth and validation failures). */
export class UploadHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "UploadHttpError";
  }
}

function abortError() {
  const error = new Error("Upload cancelled");
  error.name = "AbortError";
  return error;
}

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  checkCancelled(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * AppState-driven gate, independent of React/native modules for deterministic tests.
 * This is foreground recovery, not an OS background service or durable job queue.
 * Only use run() for idempotent requests, such as replacing the same upload chunk.
 */
export class ForegroundUpload {
  private listeners = new Set<() => void>();

  constructor(public active: boolean) {}

  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    for (const listener of [...this.listeners]) listener();
  }

  async wait(signal: AbortSignal): Promise<void> {
    checkCancelled(signal);
    if (this.active) return;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.listeners.delete(onChange);
        signal.removeEventListener("abort", onAbort);
      };
      const onChange = () => {
        if (this.active) {
          cleanup();
          resolve();
        }
      };
      const onAbort = () => {
        cleanup();
        reject(abortError());
      };
      this.listeners.add(onChange);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async run<T>(
    request: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
    options: { timeoutMs?: number; retryDelayMs?: number; maxRetries?: number } = {},
  ): Promise<T> {
    let failures = 0;
    for (;;) {
      await this.wait(signal);
      checkCancelled(signal);
      // The app can become inactive between wait() resolving and this continuation.
      if (!this.active) continue;
      const attempt = new AbortController();
      let backgrounded = false;
      const onChange = () => {
        if (!this.active) {
          backgrounded = true;
          attempt.abort();
        }
      };
      const onCancel = () => attempt.abort();
      this.listeners.add(onChange);
      signal.addEventListener("abort", onCancel, { once: true });
      const timer = setTimeout(() => attempt.abort(), options.timeoutMs ?? 120_000);
      try {
        // A suspended/native fetch may never settle. Race the request against
        // cancellation so returning to the foreground cannot leave it stuck.
        return await new Promise<T>((resolve, reject) => {
          const onAbort = () => reject(
            signal.aborted || backgrounded ? abortError() : new Error("Upload request timed out"),
          );
          attempt.signal.addEventListener("abort", onAbort, { once: true });
          void Promise.resolve().then(() => {
            checkCancelled(attempt.signal);
            return request(attempt.signal);
          }).then(resolve, reject).finally(() => {
            attempt.signal.removeEventListener("abort", onAbort);
          });
        });
      } catch (error) {
        checkCancelled(signal);
        // Permanent HTTP errors remain errors even if the app was backgrounded.
        if (error instanceof UploadHttpError &&
            error.status !== 408 && error.status !== 429 && error.status < 500) {
          throw error;
        }
        if (!backgrounded && ++failures > (options.maxRetries ?? 2)) throw error;
        if (!backgrounded) {
          await delay((options.retryDelayMs ?? 1_000) * failures, signal);
        }
      } finally {
        clearTimeout(timer);
        this.listeners.delete(onChange);
        signal.removeEventListener("abort", onCancel);
      }
    }
  }
}
