import { useAuth } from "@clerk/expo";
import { fetch as expoFetch } from "expo/fetch";
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

type StreamEvent =
  | { type: "user_message"; message: Message }
  | { type: "token"; content: string }
  | { type: "done"; message: Message }
  | { type: "error"; error: string }
  | { type: "memory_sources"; sources: unknown[] };

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

        const response = await expoFetch(`${baseUrl}/api/threads/${threadId}/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ content }),
          signal: controller.signal,
        });

        // The server now always returns SSE (even for API-key errors), so a
        // non-200 here means a genuine network/auth failure before the stream starts.
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let accumulated = "";
        let buffer = "";
        let streamError: string | null = null;

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === "[DONE]") continue;

            let event: StreamEvent;
            try {
              event = JSON.parse(raw) as StreamEvent;
            } catch {
              // Skip malformed SSE frames — they are not application-level errors.
              continue;
            }

            // Handle each event type OUTSIDE the JSON-parse try/catch so that
            // errors thrown here propagate correctly to the outer catch block.
            if (event.type === "user_message") {
              // User message persisted on server — no local UI change needed
              // because the chat screen already added it optimistically.
            } else if (event.type === "token") {
              if (event.content) {
                accumulated += event.content;
                setState((s) => ({ ...s, streamingContent: accumulated }));
              }
            } else if (event.type === "done") {
              setState({ streaming: false, streamingContent: "", error: null });
              onMessageSaved?.(event.message);
              return;
            } else if (event.type === "error") {
              // Server sent an application-level error (e.g. missing API key).
              // Store it and break out of the read loop — don't throw inside the
              // loop because we still want to drain any remaining bytes cleanly.
              streamError = (event as { type: "error"; error?: string; content?: string }).error
                ?? (event as { type: "error"; error?: string; content?: string }).content
                ?? "Stream error";
              break outer;
            }
          }
        }

        if (streamError) {
          setState({ streaming: false, streamingContent: "", error: streamError });
        } else {
          setState({ streaming: false, streamingContent: "", error: null });
        }
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
