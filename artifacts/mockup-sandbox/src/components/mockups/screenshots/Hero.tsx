import { COLORS, FONT_SANS, NeonWordmark, Screen, StatusBar } from "./shared";

export default function Hero() {
  return (
    <Screen>
      <StatusBar />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 48px",
          textAlign: "center",
          gap: 28,
        }}
      >
        <NeonWordmark size={88} />
        <p
          style={{
            fontSize: 30,
            lineHeight: 1.35,
            color: COLORS.foreground,
            opacity: 0.92,
            maxWidth: 560,
            margin: 0,
          }}
        >
          Your AI conversations, encrypted and remembered forever.
        </p>
        <p
          style={{
            fontSize: 22,
            color: COLORS.muted,
            maxWidth: 520,
            margin: 0,
          }}
        >
          Chat with Grok, organize threads into profiles, and keep every
          memory end-to-end encrypted on your own vault.
        </p>

        <div
          style={{
            marginTop: 24,
            width: "100%",
            maxWidth: 480,
            background: COLORS.accent,
            color: COLORS.accentForeground,
            borderRadius: 18,
            padding: "26px 0",
            fontSize: 26,
            fontWeight: 700,
            boxShadow: `0 0 24px ${COLORS.accent}88, 0 0 60px ${COLORS.accent}44`,
          }}
        >
          Sign in to continue
        </div>

        <div
          style={{
            display: "flex",
            gap: 36,
            marginTop: 12,
            color: COLORS.muted,
            fontSize: 18,
            fontFamily: FONT_SANS,
          }}
        >
          <span>🔒 End-to-end encrypted</span>
          <span>🧠 Semantic memory</span>
        </div>
      </div>
    </Screen>
  );
}
