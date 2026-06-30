import { COLORS, NeonWordmark, Screen, StatusBar } from "./shared";

function Bubble({
  role,
  children,
}: {
  role: "user" | "assistant";
  children: string;
}) {
  const isUser = role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        padding: "0 24px",
      }}
    >
      <div
        style={{
          maxWidth: "78%",
          background: isUser ? COLORS.accent : COLORS.card,
          color: isUser ? COLORS.accentForeground : COLORS.foreground,
          border: isUser ? "none" : `1px solid ${COLORS.border}66`,
          borderRadius: 20,
          padding: "16px 20px",
          fontSize: 20,
          lineHeight: 1.45,
          boxShadow: isUser ? `0 0 16px ${COLORS.accent}55` : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function ActiveChat() {
  return (
    <Screen>
      <StatusBar />
      <div
        style={{
          padding: "8px 24px 16px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${COLORS.border}55`,
          paddingBottom: 16,
        }}
      >
        <NeonWordmark size={32} />
        <div style={{ color: COLORS.muted, fontSize: 18 }}>Grok 4</div>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 20,
          padding: "24px 0",
          overflow: "hidden",
        }}
      >
        <Bubble role="user">
          Can you summarize what we decided about the snapshot recovery flow?
        </Bubble>
        <Bubble role="assistant">
          Sure — here's the gist: snapshots are taken every 6 hours, encrypted
          with your per-user key, and you can restore any of the last 7 by
          confirming a one-time code sent to your device. 🔐
        </Bubble>
        <Bubble role="user">Nice. Add that to my pinned memory.</Bubble>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-start",
            padding: "0 24px",
            gap: 8,
            alignItems: "center",
          }}
        >
          <div
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}66`,
              borderRadius: 20,
              padding: "16px 22px",
              display: "flex",
              gap: 8,
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: COLORS.accent,
                  opacity: 0.4 + i * 0.3,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: "16px 24px 32px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            flex: 1,
            background: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 24,
            padding: "18px 22px",
            color: COLORS.muted,
            fontSize: 20,
          }}
        >
          Message Memory Machine…
        </div>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            background: COLORS.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            color: COLORS.accentForeground,
            boxShadow: `0 0 18px ${COLORS.accent}88`,
            flexShrink: 0,
          }}
        >
          ➤
        </div>
      </div>
    </Screen>
  );
}
