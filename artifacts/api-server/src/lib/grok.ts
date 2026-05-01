/**
 * grok.ts — Thin wrapper around the xAI / Grok chat-completions API.
 *
 * Exposes a single streaming helper used by the /threads/:id/stream route.
 * Keeping this isolated makes it easy to swap models or API providers later.
 */

export interface GrokMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface GrokStreamCallbacks {
  /** Called for every text delta received from the API. */
  onToken: (delta: string) => void;
  /** Called once the stream completes (with the full assembled content). */
  onDone: (fullContent: string) => void;
  /** Called on any error — upstream HTTP error or network failure. */
  onError: (message: string) => void;
}

/**
 * Stream a chat completion from the Grok API.
 * Returns after the stream is fully consumed (or on error).
 */
export async function streamGrokCompletion(
  apiKey: string,
  model: string,
  messages: GrokMessage[],
  callbacks: GrokStreamCallbacks,
): Promise<void> {
  let response: Response;

  try {
    response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: true }),
    });
  } catch (err) {
    callbacks.onError("Failed to connect to Grok API");
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    callbacks.onError(`Grok API error: ${response.status} ${errorText}`);
    return;
  }

  const reader = response.body!.getReader();
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
