import { COLORS, NeonWordmark, Screen, StatusBar } from "./shared";

function Row({
  emoji,
  label,
  value,
  toggled,
}: {
  emoji: string;
  label: string;
  value?: string;
  toggled?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: COLORS.card,
        border: `1px solid ${COLORS.border}55`,
        borderRadius: 16,
        padding: "18px 20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 24 }}>{emoji}</span>
        <span style={{ fontSize: 20, fontWeight: 500 }}>{label}</span>
      </div>
      {toggled !== undefined ? (
        <div
          style={{
            width: 52,
            height: 30,
            borderRadius: 999,
            background: toggled ? COLORS.accent : COLORS.border,
            position: "relative",
            boxShadow: toggled ? `0 0 12px ${COLORS.accent}88` : "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 3,
              left: toggled ? 25 : 3,
              width: 24,
              height: 24,
              borderRadius: 999,
              background: "#fff",
            }}
          />
        </div>
      ) : (
        <span style={{ fontSize: 18, color: COLORS.muted }}>{value}</span>
      )}
    </div>
  );
}

export default function Settings() {
  return (
    <Screen>
      <StatusBar />
      <div style={{ padding: "8px 28px 20px", flexShrink: 0 }}>
        <NeonWordmark size={32} />
        <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 18 }}>
          Settings
        </h1>
      </div>

      <div
        style={{
          flex: 1,
          padding: "0 24px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            background: COLORS.accentDim,
            border: `1px solid ${COLORS.accent}55`,
            borderRadius: 18,
            padding: "20px 22px",
            marginBottom: 6,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 999,
              background: COLORS.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
            }}
          >
            🧠
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>Work Profile</div>
            <div style={{ fontSize: 17, color: COLORS.muted }}>
              Encrypted · 312 conversations
            </div>
          </div>
        </div>

        <Row emoji="🔐" label="Field-level encryption" toggled />
        <Row emoji="🤖" label="Default model" value="Grok 4" />
        <Row emoji="📚" label="Smart memory retrieval" toggled />
        <Row emoji="🪪" label="Trusted devices" value="2 active" />
        <Row emoji="🗄️" label="Snapshot backups" value="Every 6h" />
        <Row emoji="🔑" label="Memory Bridge (MCP) token" value="•••• 8f2a" />
      </div>
    </Screen>
  );
}
