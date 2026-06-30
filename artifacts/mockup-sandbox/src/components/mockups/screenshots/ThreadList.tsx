import { COLORS, NeonWordmark, Screen, StatusBar } from "./shared";

const THREADS = [
  { title: "Rewriting our onboarding flow", time: "2m", emoji: "🚀", pinned: true },
  { title: "Trip planning: Lisbon in October", time: "1h", emoji: "✈️" },
  { title: "Debugging the snapshot cron job", time: "3h", emoji: "🛠️" },
  { title: "Birthday gift ideas for Mom", time: "Yesterday", emoji: "🎁" },
  { title: "Notes from the product review", time: "Yesterday", emoji: "📝" },
  { title: "Grok, summarize this research paper", time: "2d", emoji: "📄" },
  { title: "Recipe: weeknight pad thai", time: "3d", emoji: "🍜" },
  { title: "Career advice — Series B startup", time: "5d", emoji: "💼" },
];

export default function ThreadList() {
  return (
    <Screen bg={COLORS.sidebar}>
      <StatusBar />
      <div style={{ padding: "8px 28px 20px", flexShrink: 0 }}>
        <NeonWordmark size={40} />
      </div>

      <div
        style={{
          margin: "0 24px 20px",
          background: COLORS.card,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 16,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          color: COLORS.muted,
          fontSize: 20,
          flexShrink: 0,
        }}
      >
        <span style={{ color: COLORS.accent, fontSize: 22 }}>🔍</span>
        Search conversations…
      </div>

      <div
        style={{
          margin: "0 24px 16px",
          display: "flex",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            background: COLORS.accent,
            color: COLORS.accentForeground,
            borderRadius: 14,
            padding: "16px 0",
            textAlign: "center",
            fontSize: 20,
            fontWeight: 700,
            boxShadow: `0 0 18px ${COLORS.accent}77`,
          }}
        >
          + New conversation
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflow: "hidden",
          padding: "4px 24px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {THREADS.map((t) => (
          <div
            key={t.title}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              background: COLORS.card,
              border: `1px solid ${t.pinned ? COLORS.accent : COLORS.border}66`,
              borderRadius: 16,
              padding: "18px 20px",
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: COLORS.accentDim,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 26,
                flexShrink: 0,
              }}
            >
              {t.emoji}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 21,
                  fontWeight: 600,
                  color: COLORS.foreground,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {t.pinned ? "📌 " : ""}
                {t.title}
              </div>
              <div style={{ fontSize: 17, color: COLORS.muted, marginTop: 4 }}>
                {t.time} ago
              </div>
            </div>
          </div>
        ))}
      </div>
    </Screen>
  );
}
