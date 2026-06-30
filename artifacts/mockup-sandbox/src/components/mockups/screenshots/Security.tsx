import { COLORS, NeonWordmark, Screen, StatusBar } from "./shared";

function Card({
  emoji,
  title,
  desc,
  action,
}: {
  emoji: string;
  title: string;
  desc: string;
  action: string;
}) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}55`,
        borderRadius: 18,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 26 }}>{emoji}</span>
        <span style={{ fontSize: 21, fontWeight: 700 }}>{title}</span>
      </div>
      <p style={{ fontSize: 18, color: COLORS.muted, margin: 0, lineHeight: 1.4 }}>
        {desc}
      </p>
      <div
        style={{
          marginTop: 6,
          alignSelf: "flex-start",
          fontSize: 17,
          fontWeight: 700,
          color: COLORS.accent,
        }}
      >
        {action} →
      </div>
    </div>
  );
}

export default function Security() {
  return (
    <Screen>
      <StatusBar />
      <div style={{ padding: "8px 28px 4px", flexShrink: 0 }}>
        <NeonWordmark size={32} />
        <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 18 }}>
          Security & Recovery
        </h1>
        <p style={{ fontSize: 18, color: COLORS.muted, marginTop: 6 }}>
          Every message is encrypted at rest with your own key.
        </p>
      </div>

      <div
        style={{
          flex: 1,
          padding: "20px 24px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            background: COLORS.accentDim,
            border: `1px solid ${COLORS.accent}66`,
            borderRadius: 18,
            padding: "20px 22px",
          }}
        >
          <span style={{ fontSize: 30 }}>✅</span>
          <div>
            <div style={{ fontSize: 21, fontWeight: 700, color: COLORS.accent }}>
              AES-256-GCM active
            </div>
            <div style={{ fontSize: 16, color: COLORS.muted }}>
              Per-user encryption key derived via HKDF
            </div>
          </div>
        </div>

        <Card
          emoji="🪪"
          title="Trusted devices"
          desc="iPhone 15 Pro and MacBook Air are trusted. Revoke access instantly from any device."
          action="Manage devices"
        />
        <Card
          emoji="🗄️"
          title="Snapshot recovery"
          desc="Automatic encrypted snapshots every 6 hours. Restore the last 7 with a one-time code."
          action="View snapshots"
        />
        <Card
          emoji="🚦"
          title="Login rate limiting"
          desc="Suspicious sign-in attempts are throttled and your IP is temporarily blocked."
          action="Security log"
        />
      </div>
    </Screen>
  );
}
