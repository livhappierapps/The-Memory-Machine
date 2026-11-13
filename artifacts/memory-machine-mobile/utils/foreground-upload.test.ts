import assert from "node:assert/strict";
import test from "node:test";
import { ForegroundUpload, UploadHttpError } from "./foreground-upload";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const fast = { retryDelayMs: 0, timeoutMs: 100 };

test("a background transition immediately after starting cannot slip a send through", async () => {
  const foreground = new ForegroundUpload(true);
  let sent = 0;
  const pending = foreground.run(async () => ++sent, new AbortController().signal, fast);
  foreground.setActive(false);
  await tick();
  assert.equal(sent, 0);
  foreground.setActive(true);
  assert.equal(await pending, 1);
});

test("an upload started in the background waits until the app is active", async () => {
  const foreground = new ForegroundUpload(false);
  const controller = new AbortController();
  let sent = 0;
  const pending = foreground.run(async () => ++sent, controller.signal, fast);
  await tick();
  assert.equal(sent, 0);
  foreground.setActive(true);
  assert.equal(await pending, 1);
});

test("switching apps aborts a stuck chunk and resends only that chunk on return", async () => {
  const foreground = new ForegroundUpload(true);
  const controller = new AbortController();
  const sent: number[] = [];
  const acknowledged: number[] = [];
  let firstSignal: AbortSignal | undefined;
  const upload = async () => {
    for (let index = 0; index < 3; index++) {
      await foreground.run(async (signal) => {
        sent.push(index);
        if (index === 1 && !firstSignal) {
          firstSignal = signal;
          // Models native fetch hanging forever after OS suspension.
          return new Promise<void>(() => {});
        }
      }, controller.signal, fast);
      acknowledged.push(index);
    }
  };
  const pending = upload();
  await tick();
  assert.deepEqual(sent, [0, 1]);
  foreground.setActive(false);
  await tick();
  assert.equal(firstSignal?.aborted, true);
  assert.deepEqual(acknowledged, [0]);
  assert.deepEqual(sent, [0, 1]);
  foreground.setActive(true);
  await pending;
  assert.deepEqual(sent, [0, 1, 1, 2]);
  assert.deepEqual(acknowledged, [0, 1, 2]);
});

test("repeated app switches keep one sequential attempt and cursor", async () => {
  const foreground = new ForegroundUpload(true);
  const controller = new AbortController();
  let attempts = 0;
  const pending = foreground.run(async () => {
    if (++attempts < 3) return new Promise<string>(() => {});
    return "saved";
  }, controller.signal, fast);
  for (let i = 0; i < 2; i++) {
    await tick();
    foreground.setActive(false);
    await tick();
    assert.equal(attempts, i + 1);
    foreground.setActive(true);
  }
  assert.equal(await pending, "saved");
  assert.equal(attempts, 3);
});

test("cancel while paused prevents later resumption", async () => {
  const foreground = new ForegroundUpload(false);
  const controller = new AbortController();
  let sent = 0;
  const pending = foreground.run(async () => ++sent, controller.signal, fast);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  controller.abort();
  foreground.setActive(true);
  await rejected;
  assert.equal(sent, 0);
});

test("cancel a stuck foreground request without waiting for fetch to settle", async () => {
  const foreground = new ForegroundUpload(true);
  const controller = new AbortController();
  const pending = foreground.run(() => new Promise(() => {}), controller.signal, fast);
  await tick();
  const rejected = assert.rejects(pending, { name: "AbortError" });
  controller.abort();
  await rejected;
});

test("transient network errors retry within a fixed limit", async () => {
  const foreground = new ForegroundUpload(true);
  let attempts = 0;
  assert.equal(await foreground.run(async () => {
    if (++attempts < 3) throw new TypeError("Network request failed");
    return "ok";
  }, new AbortController().signal, fast), "ok");
  assert.equal(attempts, 3);
});

test("persistent network errors stop after three attempts", async () => {
  const foreground = new ForegroundUpload(true);
  let attempts = 0;
  await assert.rejects(foreground.run(async () => {
    attempts++;
    throw new TypeError("Offline");
  }, new AbortController().signal, fast), /Offline/);
  assert.equal(attempts, 3);
});

test("auth, permission and validation failures never retry", async () => {
  for (const status of [400, 401, 403, 413, 422]) {
    const foreground = new ForegroundUpload(true);
    let attempts = 0;
    await assert.rejects(foreground.run(async () => {
      attempts++;
      throw new UploadHttpError("Rejected", status);
    }, new AbortController().signal, fast), /Rejected/);
    assert.equal(attempts, 1);
  }
});

test("server, rate-limit and timeout responses retry safely", async () => {
  for (const status of [408, 429, 500, 503]) {
    let attempts = 0;
    const foreground = new ForegroundUpload(true);
    await foreground.run(async () => {
      if (++attempts === 1) throw new UploadHttpError("Temporary", status);
    }, new AbortController().signal, fast);
    assert.equal(attempts, 2);
  }
});

test("a hung request times out instead of stalling indefinitely", async () => {
  const foreground = new ForegroundUpload(true);
  let attempts = 0;
  await assert.rejects(foreground.run(async () => {
    attempts++;
    return new Promise(() => {});
  }, new AbortController().signal, { ...fast, timeoutMs: 5, maxRetries: 0 }), /timed out/);
  assert.equal(attempts, 1);
});

test("finalize waits for the foreground and is not retried by the upload helper", async () => {
  const foreground = new ForegroundUpload(false);
  const controller = new AbortController();
  let finalizations = 0;
  const finish = (async () => {
    await foreground.wait(controller.signal);
    finalizations++;
  })();
  await tick();
  assert.equal(finalizations, 0);
  foreground.setActive(true);
  await finish;
  foreground.setActive(false);
  foreground.setActive(true);
  assert.equal(finalizations, 1);
});

test("cancellation during retry backoff stops further sends", async () => {
  const foreground = new ForegroundUpload(true);
  const controller = new AbortController();
  let attempts = 0;
  const pending = foreground.run(async () => {
    attempts++;
    throw new Error("Offline");
  }, controller.signal, { retryDelayMs: 10_000 });
  await tick();
  const rejected = assert.rejects(pending, { name: "AbortError" });
  controller.abort();
  await rejected;
  assert.equal(attempts, 1);
});
