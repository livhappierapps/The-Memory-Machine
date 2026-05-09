import { useState, useCallback, useRef } from "react";
import { Message } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetThreadMessagesQueryKey } from "@workspace/api-client-react";

type StreamEvent =
  | { type: "user_message"; message: Message }
  | { type: "token"; content: string }
  | { type: "done"; message: Message }
  | { type: "error"; error: string };

export function useChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const streamMessage = useCallback(
    async (threadId: number, content: string) => {
      setIsStreaming(true);
      setStreamingContent("");
      setError(null);

      const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(`${basePath}/api/threads/${threadId}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
          credentials: "include",
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to stream: ${response.statusText}`);
        }

        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const event = JSON.parse(data) as StreamEvent;
              if (event.type === "user_message") {
                queryClient.setQueryData<Message[]>(
                  getGetThreadMessagesQueryKey(threadId),
                  (old) => {
                    const msgs = old ?? [];
                    return msgs.some((m) => m.id === event.message.id)
                      ? msgs
                      : [...msgs, event.message];
                  },
                );
              } else if (event.type === "token") {
                setStreamingContent((prev) => prev + event.content);
              } else if (event.type === "done") {
                queryClient.setQueryData<Message[]>(
                  getGetThreadMessagesQueryKey(threadId),
                  (old) => {
                    const msgs = old ?? [];
                    return msgs.some((m) => m.id === event.message.id)
                      ? msgs
                      : [...msgs, event.message];
                  },
                );
                setStreamingContent("");
              } else if (event.type === "error") {
                setError(event.error);
              }
            } catch {
              // skip malformed SSE frames
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err.message || "An error occurred while streaming");
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [queryClient],
  );

  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return { streamMessage, stopStream, isStreaming, streamingContent, error };
}
