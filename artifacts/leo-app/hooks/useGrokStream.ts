import { fetch as expoFetch } from "expo/fetch";
import { useCallback, useRef, useState } from "react";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

interface StreamState {
  streaming: boolean;
  streamingContent: string;
  error: string | null;
}

interface UseGrokStreamOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  onMessageComplete?: (msg: Message) => void;
}

export function useGrokStream({ apiKey, model, systemPrompt, onMessageComplete }: UseGrokStreamOptions) {
  const [state, setState] = useState<StreamState>({
    streaming: false,
    streamingContent: "",
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (history: Message[], userContent: string) => {
      if (state.streaming || !apiKey) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ streaming: true, streamingContent: "", error: null });

      const messages = [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userContent },
      ];

      try {
        const res = await expoFetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model, messages, stream: true }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.text().catch(() => `HTTP ${res.status}`);
          throw new Error(err);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let accumulated = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === "[DONE]") continue;

            try {
              const chunk = JSON.parse(raw) as {
                choices: Array<{ delta: { content?: string }; finish_reason?: string }>;
              };
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                accumulated += delta;
                setState((s) => ({ ...s, streamingContent: accumulated }));
              }
              if (chunk.choices[0]?.finish_reason === "stop") {
                const msg: Message = {
                  id: Date.now().toString(),
                  role: "assistant",
                  content: accumulated,
                };
                setState({ streaming: false, streamingContent: "", error: null });
                onMessageComplete?.(msg);
                return;
              }
            } catch {
              // skip malformed chunks
            }
          }
        }

        // Stream ended without explicit stop
        if (accumulated) {
          const msg: Message = { id: Date.now().toString(), role: "assistant", content: accumulated };
          onMessageComplete?.(msg);
        }
        setState({ streaming: false, streamingContent: "", error: null });
      } catch (err: unknown) {
        if ((err as Error)?.name === "AbortError") {
          setState({ streaming: false, streamingContent: "", error: null });
          return;
        }
        setState({
          streaming: false,
          streamingContent: "",
          error: err instanceof Error ? err.message : "Connection failed",
        });
      }
    },
    [apiKey, model, systemPrompt, state.streaming, onMessageComplete],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { ...state, sendMessage, abort };
}
