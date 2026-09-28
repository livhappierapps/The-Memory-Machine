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

const HISTORY_CAP = 40;

export function useGrokStream({ apiKey, model, systemPrompt, onMessageComplete }: UseGrokStreamOptions) {
  const [state, setState] = useState<StreamState>({
    streaming: false,
    streamingContent: "",
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const accRef = useRef("");

  const finish = useCallback(
    (content: string) => {
      if (!content.trim()) {
        setState({ streaming: false, streamingContent: "", error: null });
        return;
      }
      const msg: Message = {
        id: `${Date.now()}`,
        role: "assistant",
        content,
      };
      setState({ streaming: false, streamingContent: "", error: null });
      onMessageComplete?.(msg);
    },
    [onMessageComplete],
  );

  const sendMessage = useCallback(
    async (history: Message[], userContent: string) => {
      if (state.streaming || !apiKey) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      accRef.current = "";

      setState({ streaming: true, streamingContent: "", error: null });

      const trimmedHistory = history.slice(-HISTORY_CAP).filter((m) => m.role !== "system");

      const messages = [
        { role: "system", content: systemPrompt },
        ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
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
          throw new Error(err.slice(0, 400));
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
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
                choices: Array<{ delta: { content?: string }; finish_reason?: string | null }>;
              };
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                accRef.current += delta;
                const snapshot = accRef.current;
                setState((s) => ({ ...s, streamingContent: snapshot }));
              }
              const reason = chunk.choices[0]?.finish_reason;
              if (reason === "stop" || reason === "length") {
                finish(accRef.current);
                return;
              }
            } catch {
              // skip malformed chunks
            }
          }
        }

        finish(accRef.current);
      } catch (err: unknown) {
        if ((err as Error)?.name === "AbortError") {
          finish(accRef.current);
          return;
        }
        setState({
          streaming: false,
          streamingContent: "",
          error: err instanceof Error ? err.message : "Connection failed",
        });
      }
    },
    [apiKey, model, systemPrompt, state.streaming, finish],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { ...state, sendMessage, abort };
}
