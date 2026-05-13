import { useAuth } from "@clerk/expo";
import { useCallback, useRef, useState } from "react";

import type { Message } from "@workspace/api-client-react";

interface UseChatStreamOptions {
  threadId: number;
  onMessageSaved?: (message: Message) => void;
}

interface StreamState {
  streaming: boolean;
  streamingContent: string;
  error: string | null;
}

export function useChatStream({ threadId, onMessageSaved }: UseChatStreamOptions) {
  const { getToken } = useAuth();
  const [state, setState] = useState<StreamState>({
    streaming: false,
    streamingContent: "",
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      if (state.streaming) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ streaming: true, streamingContent: "", error: null });

      try {
        const token = await getToken();
        const baseUrl = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}`;

        const { fetch: expoFetch } = await import("expo/fetch");

        const response = await expoFetch(`${baseUrl}/api/threads/${threadId}/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ content }),
          signal: controller.signal,
        } as RequestInit);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
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
              const event = JSON.parse(raw) as {
                type: string;
                content?: string;
                message?: Message;
              };

              if (event.type === "token" && event.content) {
                accumulated += event.content;
                setState((s) => ({ ...s, streamingContent: accumulated }));
              } else if (event.type === "done" && event.message) {
                setState({ streaming: false, streamingContent: "", error: null });
                onMessageSaved?.(event.message);
                return;
              } else if (event.type === "error") {
                throw new Error(event.content ?? "Stream error");
              }
            } catch {
              // ignore parse errors on individual lines
            }
          }
        }

        setState({ streaming: false, streamingContent: "", error: null });
      } catch (err: unknown) {
        if ((err as Error)?.name === "AbortError") {
          setState({ streaming: false, streamingContent: "", error: null });
          return;
        }
        const msg = err instanceof Error ? err.message : "Failed to stream response";
        setState({ streaming: false, streamingContent: "", error: msg });
      }
    },
    [threadId, getToken, state.streaming, onMessageSaved],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { ...state, sendMessage, abort };
}
