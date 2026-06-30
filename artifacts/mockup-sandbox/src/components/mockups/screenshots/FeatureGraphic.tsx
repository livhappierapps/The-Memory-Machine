import { appIcon, COLORS, FONT_SANS } from "./shared";

export default function FeatureGraphic() {
  return (
    <div
      style={{
        width: "1024px",
        height: "500px",
        background: `linear-gradient(135deg, ${COLORS.background} 0%, #1f2a29 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 56,
        fontFamily: FONT_SANS,
        color: COLORS.foreground,
        overflow: "hidden",
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 20% 30%, ${COLORS.accent}22, transparent 55%), radial-gradient(circle at 85% 75%, ${COLORS.accent}1a, transparent 50%)`,
        }}
      />

      <div
        style={{
          width: 180,
          height: 180,
          borderRadius: 44,
          overflow: "hidden",
          boxShadow: `0 0 50px ${COLORS.accent}99, 0 0 110px ${COLORS.accent}55`,
          flexShrink: 0,
          zIndex: 1,
        }}
      >
        <img
          src={appIcon}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>

      <div style={{ zIndex: 1 }}>
        <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: -1 }}>
          Memory Machine
        </div>
        <div
          style={{
            fontSize: 26,
            color: COLORS.muted,
            marginTop: 12,
            maxWidth: 560,
            lineHeight: 1.35,
          }}
        >
          Your encrypted AI conversation vault — chat, remember, recall.
        </div>
      </div>
    </div>
  );
}
