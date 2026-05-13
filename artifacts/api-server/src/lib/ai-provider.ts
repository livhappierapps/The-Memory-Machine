// Unified AI provider abstraction — routes chat completion streaming to
// xAI, OpenAI, Anthropic, or Google Gemini based on profile settings.

export type ChatProvider = "xai" | "openai" | "anthropic" | "google";

export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamCallbacks {
  onToken: (delta: string) => void;
  onDone: (fullContent: string) => void;
  onError: (message: string) => void;
}

// Provider-specific display names for error messages.
const PROVIDER_LABEL: Record<ChatProvider, string> = {
  xai: "Grok (xAI)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
};

// ── OpenAI-compatible providers (xAI and OpenAI share the same format) ───────

const OPENAI_COMPAT_BASE: Record<string, string> = {
  xai: "https://api.x.ai/v1",
  openai: "https://api.openai.com/v1",
};

async function streamOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: AIMessage[],
  label: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: true }),
    });
  } catch {
    callbacks.onError(`Failed to connect to ${label} API`);
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    callbacks.onError(`${label} API error: ${response.status} ${text}`);
    return;
  }
  if (!response.body) {
    callbacks.onError(`${label} API returned an empty response body`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data);
        const delta: string | undefined = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          callbacks.onToken(delta);
        }
      } catch {
        // skip malformed SSE chunks
      }
    }
  }

  callbacks.onDone(fullContent);
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

async function streamAnthropic(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  callbacks: StreamCallbacks,
): Promise<void> {
  // Anthropic separates system messages from the conversation turns.
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const turns = messages.filter((m) => m.role !== "system");

  // Anthropic requires alternating user/assistant turns — merge consecutive same-role messages.
  const merged: { role: "user" | "assistant"; content: string }[] = [];
  for (const msg of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      last.content += "\n\n" + msg.content;
    } else {
      merged.push({ role: msg.role as "user" | "assistant", content: msg.content });
    }
  }

  // Anthropic requires the first message to be from the user.
  if (merged.length === 0 || merged[0]!.role !== "user") {
    callbacks.onError("Anthropic API error: conversation must start with a user message");
    return;
  }

  const body: Record<string, unknown> = {
    model,
    messages: merged,
    max_tokens: 8192,
    stream: true,
  };
  if (systemParts.length > 0) body.system = systemParts.join("\n\n");

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
  } catch {
    callbacks.onError("Failed to connect to Anthropic API");
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    callbacks.onError(`Anthropic API error: ${response.status} ${text}`);
    return;
  }
  if (!response.body) {
    callbacks.onError("Anthropic API returned an empty response body");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      try {
        const chunk = JSON.parse(data);
        // content_block_delta carries text deltas
        if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
          const delta: string = chunk.delta.text ?? "";
          if (delta) {
            fullContent += delta;
            callbacks.onToken(delta);
          }
        }
      } catch {
        // skip malformed SSE chunks
      }
    }
  }

  callbacks.onDone(fullContent);
}

// ── Google Gemini ─────────────────────────────────────────────────────────────

async function streamGemini(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  callbacks: StreamCallbacks,
): Promise<void> {
  // Gemini uses "user" / "model" roles and takes system prompts separately.
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const turns = messages.filter((m) => m.role !== "system");

  // Convert to Gemini's content format, mapping "assistant" → "model".
  const contents = turns.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = { contents };
  if (systemParts.length > 0) {
    body.systemInstruction = { parts: [{ text: systemParts.join("\n\n") }] };
  }
  body.generationConfig = { maxOutputTokens: 8192 };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    callbacks.onError("Failed to connect to Google Gemini API");
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    callbacks.onError(`Google Gemini API error: ${response.status} ${text}`);
    return;
  }
  if (!response.body) {
    callbacks.onError("Google Gemini API returned an empty response body");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      try {
        const chunk = JSON.parse(data);
        const text: string | undefined = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          fullContent += text;
          callbacks.onToken(text);
        }
      } catch {
        // skip malformed SSE chunks
      }
    }
  }

  callbacks.onDone(fullContent);
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function streamCompletion(
  provider: ChatProvider,
  apiKey: string,
  model: string,
  messages: AIMessage[],
  callbacks: StreamCallbacks,
): Promise<void> {
  const label = PROVIDER_LABEL[provider];

  switch (provider) {
    case "xai":
    case "openai":
      return streamOpenAICompat(OPENAI_COMPAT_BASE[provider]!, apiKey, model, messages, label, callbacks);
    case "anthropic":
      return streamAnthropic(apiKey, model, messages, callbacks);
    case "google":
      return streamGemini(apiKey, model, messages, callbacks);
    default:
      callbacks.onError(`Unsupported AI provider: ${provider}`);
  }
}

/** Resolve the chat API key for a given provider from profile fields. */
export function resolveChatKey(
  provider: ChatProvider,
  profileApiKey: string | null,
  openAiApiKey: string | null,
  anthropicApiKey: string | null,
  googleApiKey: string | null,
): string | null {
  switch (provider) {
    case "xai":     return profileApiKey;
    case "openai":  return openAiApiKey;
    case "anthropic": return anthropicApiKey;
    case "google":  return googleApiKey;
    default:        return null;
  }
}
