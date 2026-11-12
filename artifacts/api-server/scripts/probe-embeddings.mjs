#!/usr/bin/env node
// Probe the configured embedding provider WITHOUT touching the database.
// Prints available xAI embedding models, then makes one test embedding call
// (with and without `dimensions`) and reports the returned vector length.
// Never prints the API key.
//
//   pnpm --filter @workspace/api-server run embeddings:probe
//
// Env: XAI_API_KEY (or EMBEDDING_API_KEY), optional XAI_EMBEDDING_MODEL,
//      EMBEDDING_DIM (default 1536).

const key = process.env.EMBEDDING_API_KEY?.trim() || process.env.XAI_API_KEY?.trim();
if (!key) {
  console.error("No XAI_API_KEY / EMBEDDING_API_KEY in env — nothing to probe.");
  process.exit(2);
}
const model = process.env.XAI_EMBEDDING_MODEL?.trim() || "v1";
const dim = Number.parseInt(process.env.EMBEDDING_DIM ?? "1536", 10) || 1536;
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function listModels() {
  const r = await fetch("https://api.x.ai/v1/embedding-models", { headers });
  console.log(`GET /v1/embedding-models → HTTP ${r.status}`);
  if (!r.ok) {
    console.log((await r.text()).slice(0, 300));
    return;
  }
  const j = await r.json();
  for (const m of j.models ?? j.data ?? []) {
    const { id, aliases, version, prompt_text_token_price, input_modalities } = m;
    console.log(" -", JSON.stringify({ id, aliases, version, prompt_text_token_price, input_modalities }));
  }
}

async function embed(withDims) {
  const body = { model, input: "passage: The Memory Machine embedding probe." };
  if (withDims) body.dimensions = dim;
  const r = await fetch("https://api.x.ai/v1/embeddings", { method: "POST", headers, body: JSON.stringify(body) });
  const label = withDims ? `model=${model} dimensions=${dim}` : `model=${model} (no dimensions)`;
  if (!r.ok) {
    console.log(`POST /v1/embeddings ${label} → HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return null;
  }
  const j = await r.json();
  const len = j.data?.[0]?.embedding?.length;
  console.log(`POST /v1/embeddings ${label} → HTTP 200, vector length ${len}, usage ${JSON.stringify(j.usage ?? {})}, model ${j.model}`);
  return len;
}

await listModels();
const withDims = await embed(true);
const native = await embed(false);
console.log("");
if (withDims === dim) {
  console.log(`OK: the provider honours dimensions=${dim}. Keep EMBEDDING_DIM=${dim}; no column migration needed.`);
} else if (native) {
  console.log(
    `ACTION: dimensions=${dim} not honoured. Set EMBEDDING_DIM=${native} and EMBEDDING_SEND_DIMENSIONS=false; ` +
      "the server migrates the (empty) embeddings column at boot.",
  );
} else {
  console.log("ACTION: embeddings unavailable for this key/model. Check XAI_EMBEDDING_MODEL against the model list above.");
}
