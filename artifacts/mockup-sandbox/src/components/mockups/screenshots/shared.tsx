import type { ReactNode } from "react";
import appIcon from "../../../assets/app-icon.png";

export { appIcon };

export const COLORS = {
  background: "#2f2f37",
  card: "#383841",
  sidebar: "#292930",
  border: "#2e5f59",
  borderBright: "#1ad4be66",
  foreground: "#f7f7f7",
  muted: "#9a9aa0",
  accent: "#1ad4be",
  accentDim: "#15403c",
  accentForeground: "#0d1f1c",
  danger: "#ef4444",
};

export const FONT_SANS =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export function StatusBar({ dark = true }: { dark?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "18px 28px 6px",
        fontFamily: FONT_SANS,
        fontSize: 17,
        fontWeight: 600,
        color: dark ? COLORS.foreground : "#111",
        flexShrink: 0,
      }}
    >
      <span>9:41</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 14 }}>5G</span>
        <span style={{ fontSize: 14 }}>▮▮▮▮</span>
        <span style={{ fontSize: 14 }}>🔋</span>
      </div>
    </div>
  );
}

export function NeonWordmark({ size = 28 }: { size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: FONT_SANS,
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.28,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 0 16px ${COLORS.accent}99, 0 0 36px ${COLORS.accent}55`,
          flexShrink: 0,
        }}
      >
        <img
          src={appIcon}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      <span
        style={{
          fontSize: size * 0.62,
          fontWeight: 700,
          color: COLORS.foreground,
          letterSpacing: -0.3,
        }}
      >
        Memory Machine
      </span>
    </div>
  );
}

export function Screen({
  children,
  bg = COLORS.background,
}: {
  children: ReactNode;
  bg?: string;
}) {
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: bg,
        color: COLORS.foreground,
        fontFamily: FONT_SANS,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
}
