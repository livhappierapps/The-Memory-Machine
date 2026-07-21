import { useCallback, useState } from "react";

interface MemoryBridgeOptions {
  memoryMachineUrl: string;
  mcpToken: string;
}

interface RecentMessage {
  id: number;
  threadId: number;
  role: string;
  content: string;
  createdAt: string;
}

export function useMemoryBridge({ memoryMachineUrl, mcpToken }: MemoryBridgeOptions) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConfigured = Boolean(memoryMachineUrl && mcpToken);

  // Fetch recent messages via the /api/messages/recent endpoint using the MCP token
  // The MCP token is a bearer token the server can validate directly.
  const fetchRecentMemories = useCallback(
    async (limit = 40): Promise<string> => {
      if (!isConfigured) return "";
      setLoading(true);
      setError(null);
      try {
        const base = memoryMachineUrl.replace(/\/$/, "");
        const res = await fetch(`${base}/api/messages/recent?limit=${limit}`, {
          headers: { Authorization: `Bearer ${mcpToken}` },
        });
        if (!res.ok) throw new Error(`Memory Machine returned ${res.status}`);
        const msgs = (await res.json()) as RecentMessage[];

        if (!msgs.length) return "";

        // Group by thread and format as readable context
        const byThread = new Map<number, RecentMessage[]>();
        for (const m of msgs) {
          const arr = byThread.get(m.threadId) ?? [];
          arr.push(m);
          byThread.set(m.threadId, arr);
        }

        const sections: string[] = [];
        for (const [, threadMsgs] of byThread) {
          const lines = threadMsgs
            .slice()
            .reverse()
            .map((m) => `${m.role === "user" ? "You" : "Leo"}: ${m.content.slice(0, 300)}`)
            .join("\n");
          sections.push(lines);
        }

        return sections.join("\n\n---\n\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fetch memories";
        setError(msg);
        return "";
      } finally {
        setLoading(false);
      }
    },
    [memoryMachineUrl, mcpToken, isConfigured],
  );

  // Call an MCP tool directly
  const callMcpTool = useCallback(
    async (toolName: string, args: Record<string, unknown> = {}): Promise<string> => {
      if (!isConfigured) return "Memory bridge not configured.";
      setLoading(true);
      setError(null);
      try {
        const base = memoryMachineUrl.replace(/\/$/, "");
        const res = await fetch(`${base}/api/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${mcpToken}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tools/call",
            id: Date.now(),
            params: { name: toolName, arguments: args },
          }),
        });
        if (!res.ok) throw new Error(`MCP returned ${res.status}`);
        const data = (await res.json()) as {
          result?: { content?: Array<{ text?: string }> };
          error?: { message: string };
        };
        if (data.error) throw new Error(data.error.message);
        return data.result?.content?.map((c) => c.text ?? "").join("\n") ?? "No results";
      } catch (err) {
        const msg = err instanceof Error ? err.message : "MCP call failed";
        setError(msg);
        return `Memory search failed: ${msg}`;
      } finally {
        setLoading(false);
      }
    },
    [memoryMachineUrl, mcpToken, isConfigured],
  );

  return { fetchRecentMemories, callMcpTool, loading, error, isConfigured };
}
