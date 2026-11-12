import { describe, expect, it } from "vitest";
import {
  buildEmbeddingRequest,
  getEmbeddingConfig,
  getEmbeddingDim,
  MAX_INPUT_CHARS,
  resolveEmbeddingKey,
} from "../../lib/embedding-config";
import { classifyEmbeddingStatus } from "../../lib/embeddings";
import { encryptField } from "../../lib/field-crypto";

const userId = "embedding-config-user";

describe("embedding model selection", () => {
  it("uses a per-provider default model", () => {
    expect(getEmbeddingConfig("xai", {}).model).toBe("v1");
    expect(getEmbeddingConfig("openai", {}).model).toBe("text-embedding-3-small");
    expect(getEmbeddingConfig("xai", {}).endpoint).toBe("https://api.x.ai/v1/embeddings");
    expect(getEmbeddingConfig("openai", {}).endpoint).toBe("https://api.openai.com/v1/embeddings");
  });

  it("never sends the OpenAI model name to xAI", () => {
    const body = buildEmbeddingRequest(getEmbeddingConfig("xai", {}), "hello");
    expect(body.model).not.toBe("text-embedding-3-small");
  });

  it("treats unknown providers as xai", () => {
    expect(getEmbeddingConfig("anthropic", {}).provider).toBe("xai");
    expect(getEmbeddingConfig(null, {}).provider).toBe("xai");
  });

  it("honours env overrides for model and dimension", () => {
    const env = { XAI_EMBEDDING_MODEL: "grok-embed-2", EMBEDDING_DIM: "1024" };
    const cfg = getEmbeddingConfig("xai", env);
    expect(cfg.model).toBe("grok-embed-2");
    expect(cfg.dimensions).toBe(1024);
    expect(cfg.modelKey).toBe("xai:grok-embed-2:1024");
    expect(getEmbeddingConfig("openai", { OPENAI_EMBEDDING_MODEL: "text-embedding-3-large" }).model)
      .toBe("text-embedding-3-large");
  });

  it("falls back to 1536 for invalid dimensions", () => {
    expect(getEmbeddingDim({})).toBe(1536);
    expect(getEmbeddingDim({ EMBEDDING_DIM: "abc" })).toBe(1536);
    expect(getEmbeddingDim({ EMBEDDING_DIM: "-5" })).toBe(1536);
  });

  it("model key changes when model/provider/dim change (so failure markers reset)", () => {
    const a = getEmbeddingConfig("xai", {}).modelKey;
    expect(getEmbeddingConfig("openai", {}).modelKey).not.toBe(a);
    expect(getEmbeddingConfig("xai", { XAI_EMBEDDING_MODEL: "v2" }).modelKey).not.toBe(a);
    expect(getEmbeddingConfig("xai", { EMBEDDING_DIM: "768" }).modelKey).not.toBe(a);
  });

  it("builds xAI requests with query/passage prefixes and dimensions", () => {
    const cfg = getEmbeddingConfig("xai", {});
    expect(buildEmbeddingRequest(cfg, "beach trip", "query")).toEqual({
      model: "v1", input: "query: beach trip", dimensions: 1536,
    });
    expect(buildEmbeddingRequest(cfg, "we went to the beach").input).toBe("passage: we went to the beach");
  });

  it("does not prefix OpenAI input and can omit dimensions", () => {
    const cfg = getEmbeddingConfig("openai", { EMBEDDING_SEND_DIMENSIONS: "false" });
    expect(buildEmbeddingRequest(cfg, "hi", "query")).toEqual({ model: "text-embedding-3-small", input: "hi" });
  });

  it("caps the input (prefix included) at MAX_INPUT_CHARS", () => {
    const cfg = getEmbeddingConfig("xai", {});
    expect(buildEmbeddingRequest(cfg, "x".repeat(20_000)).input.length).toBe(MAX_INPUT_CHARS);
  });
});

describe("embedding key resolution", () => {
  const xai = encryptField(userId, "profile-xai-key");
  const oai = encryptField(userId, "profile-openai-key");

  it("uses the profile key matching the provider", () => {
    expect(resolveEmbeddingKey(userId, { embeddingProvider: "xai", apiKey: xai, openAiApiKey: oai }, { env: {} }))
      .toEqual({ provider: "xai", apiKey: "profile-xai-key", source: "profile" });
    expect(resolveEmbeddingKey(userId, { embeddingProvider: "openai", apiKey: xai, openAiApiKey: oai }, { env: {} }))
      .toEqual({ provider: "openai", apiKey: "profile-openai-key", source: "profile" });
  });

  it("falls back openai → xai instead of sending an xAI key to OpenAI", () => {
    expect(resolveEmbeddingKey(userId, { embeddingProvider: "openai", apiKey: xai }, { env: {} }))
      .toEqual({ provider: "xai", apiKey: "profile-xai-key", source: "profile" });
  });

  it("falls back to settings, then the server XAI_API_KEY", () => {
    const settingsKey = encryptField(userId, "settings-key");
    expect(resolveEmbeddingKey(userId, { embeddingProvider: "xai" }, { settingsApiKey: settingsKey, env: {} }))
      .toEqual({ provider: "xai", apiKey: "settings-key", source: "settings" });
    expect(resolveEmbeddingKey(userId, null, { env: { XAI_API_KEY: "server-key" } }))
      .toEqual({ provider: "xai", apiKey: "server-key", source: "server" });
    expect(resolveEmbeddingKey(userId, null, { env: { EMBEDDING_API_KEY: "emb-key", XAI_API_KEY: "x" } })?.apiKey)
      .toBe("emb-key");
  });

  it("returns null when no key exists anywhere", () => {
    expect(resolveEmbeddingKey(userId, { embeddingProvider: "xai" }, { env: {} })).toBeNull();
  });

  it("treats an undecryptable key as missing", () => {
    expect(resolveEmbeddingKey(userId, { apiKey: "enc:v1:not-valid" }, { env: { XAI_API_KEY: "srv" } }))
      .toEqual({ provider: "xai", apiKey: "srv", source: "server" });
  });
});

describe("HTTP status classification", () => {
  it("auth / wrong-model statuses are config errors, never per-message permanent", () => {
    for (const s of [401, 402, 403, 404]) {
      expect(classifyEmbeddingStatus(s)).toEqual({ permanentFailure: false, configError: true });
    }
  });
  it("input-specific 4xx are permanent; retryable ones are not", () => {
    expect(classifyEmbeddingStatus(400).permanentFailure).toBe(true);
    expect(classifyEmbeddingStatus(422).permanentFailure).toBe(true);
    for (const s of [408, 425, 429, 500, 503]) expect(classifyEmbeddingStatus(s).permanentFailure).toBe(false);
  });
});
