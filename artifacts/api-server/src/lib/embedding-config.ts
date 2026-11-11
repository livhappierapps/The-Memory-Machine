// Per-provider embedding configuration and key resolution.
//
// Everything that produces or compares vectors must agree on model + dimension,
// so this module is the single source of truth. Values come from env so the
// xAI model / dimension can be changed on Replit without a code change:
//
//   EMBEDDING_DIM          vector size stored in pgvector (default 1536)
//   XAI_EMBEDDING_MODEL    xAI model id (default "v1")
//   OPENAI_EMBEDDING_MODEL OpenAI model id (default "text-embedding-3-small")
//   EMBEDDING_SEND_DIMENSIONS  "false" to omit the `dimensions` request field
//   XAI_API_KEY / EMBEDDING_API_KEY  server-level fallback key (xAI) used when
//                          a profile has no embedding key of its own
//   OPENAI_EMBEDDING_API_KEY  server-level fallback key for provider=openai

import { decryptField } from "./field-crypto";

export type EmbeddingProvider = "xai" | "openai";
export type EmbeddingKind = "query" | "passage";

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  endpoint: string;
  model: string;
  dimensions: number;
  /** Whether to send `dimensions` in the request body. */
  sendDimensions: boolean;
  /** Prefix inputs with "query: " / "passage: " (xAI recommendation). */
  usePrefixes: boolean;
  /**
   * Stable fingerprint of the config. Permanent-failure markers in
   * embed_attempts are keyed by this, so changing model/dimension/provider makes
   * previously-failed messages eligible again instead of poisoning them forever.
   */
  modelKey: string;
}

const ENDPOINTS: Record<EmbeddingProvider, string> = {
  xai: "https://api.x.ai/v1/embeddings",
  openai: "https://api.openai.com/v1/embeddings",
};

const DEFAULT_MODELS: Record<EmbeddingProvider, string> = {
  xai: "v1",
  openai: "text-embedding-3-small",
};

type Env = Record<string, string | undefined>;

/** Max characters sent per embedding input (prefix included). */
export const MAX_INPUT_CHARS = 8_000;

export function normalizeProvider(provider: string | null | undefined): EmbeddingProvider {
  return provider === "openai" ? "openai" : "xai";
}

/** Configured vector dimension (must match the embeddings.embedding column). */
export function getEmbeddingDim(env: Env = process.env): number {
  const n = Number.parseInt(env.EMBEDDING_DIM ?? "", 10);
  return Number.isFinite(n) && n > 0 && n <= 16_000 ? n : 1536;
}

export function getEmbeddingConfig(
  provider: string | null | undefined,
  env: Env = process.env,
): EmbeddingConfig {
  const p = normalizeProvider(provider);
  const model =
    (p === "xai" ? env.XAI_EMBEDDING_MODEL : env.OPENAI_EMBEDDING_MODEL)?.trim() ||
    DEFAULT_MODELS[p];
  const dimensions = getEmbeddingDim(env);
  const sendDimensions = (env.EMBEDDING_SEND_DIMENSIONS ?? "true").toLowerCase() !== "false";
  return {
    provider: p,
    endpoint: ENDPOINTS[p],
    model,
    dimensions,
    sendDimensions,
    usePrefixes: p === "xai",
    modelKey: `${p}:${model}:${dimensions}`,
  };
}

/** Build the provider request body for one input. */
export function buildEmbeddingRequest(
  cfg: EmbeddingConfig,
  text: string,
  kind: EmbeddingKind = "passage",
): { model: string; input: string; dimensions?: number } {
  // Keep the whole request input (prefix included) within the 8k-char budget.
  const input = (cfg.usePrefixes ? `${kind}: ${text}` : text).slice(0, MAX_INPUT_CHARS);
  const body: { model: string; input: string; dimensions?: number } = { model: cfg.model, input };
  if (cfg.sendDimensions) body.dimensions = cfg.dimensions;
  return body;
}

/** Server-level fallback key for a provider (never logged). */
export function serverEmbeddingKey(
  provider: EmbeddingProvider,
  env: Env = process.env,
): string | null {
  if (provider === "openai") return env.OPENAI_EMBEDDING_API_KEY?.trim() || null;
  return env.EMBEDDING_API_KEY?.trim() || env.XAI_API_KEY?.trim() || null;
}

export interface EmbeddingKeySource {
  embeddingProvider?: string | null;
  /** Raw (possibly enc:v1:) xAI key stored on the profile. */
  apiKey?: string | null;
  /** Raw (possibly enc:v1:) OpenAI key stored on the profile. */
  openAiApiKey?: string | null;
}

export interface ResolvedEmbeddingKey {
  provider: EmbeddingProvider;
  apiKey: string;
  source: "profile" | "settings" | "server";
}

/**
 * Resolve the effective embedding provider + plaintext key.
 *
 *  - provider=openai: profile.openAiApiKey, else OPENAI_EMBEDDING_API_KEY,
 *    else fall back to xAI (never send an xAI key to OpenAI).
 *  - provider=xai: profile.apiKey, else settings.apiKey, else server key.
 *
 * Returns null when no key is available at all.
 */
export function resolveEmbeddingKey(
  userId: string,
  profile: EmbeddingKeySource | null | undefined,
  opts: { settingsApiKey?: string | null; env?: Env } = {},
): ResolvedEmbeddingKey | null {
  const env = opts.env ?? process.env;
  const wanted = normalizeProvider(profile?.embeddingProvider);
  const dec = (v: string | null | undefined) => {
    if (!v) return null;
    try {
      const plain = decryptField(userId, v);
      return plain && plain.trim() ? plain : null;
    } catch {
      return null; // undecryptable (rotated root secret / corrupt) — treat as missing
    }
  };

  if (wanted === "openai") {
    const k = dec(profile?.openAiApiKey);
    if (k) return { provider: "openai", apiKey: k, source: "profile" };
    const s = serverEmbeddingKey("openai", env);
    if (s) return { provider: "openai", apiKey: s, source: "server" };
    // fall through to xAI
  }

  const pk = dec(profile?.apiKey);
  if (pk) return { provider: "xai", apiKey: pk, source: "profile" };
  const sk = dec(opts.settingsApiKey);
  if (sk) return { provider: "xai", apiKey: sk, source: "settings" };
  const server = serverEmbeddingKey("xai", env);
  if (server) return { provider: "xai", apiKey: server, source: "server" };
  return null;
}
