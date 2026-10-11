import type React from "react";

// Vantik Signal tokens (base.css v3): ink, off-white, cardinal red as an accent only.
export const B = {
  ink: "#18181B",
  white: "#F9F8F6",
  red: "#BE1A2D",
  slate: "#6B7280",
  hair: "#E3E1DC",
  hairDark: "#2A2A2E",
  dimWhite: "#C7C9CC",
  redTint: "rgba(190,26,45,0.08)",
  green: "#3FA66B",
  amber: "#D9A441",
};

export const mono = "ui-monospace, 'IBM Plex Mono', SFMono-Regular, Menlo, monospace";

export function SectionHeader({ label, sub }: { label: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", borderBottom: `1px solid ${B.hairDark}`, paddingBottom: "0.4rem", margin: "1.25rem 0 0.6rem" }}>
      <span style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: B.red }}>{label}</span>
      {sub && <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>{sub}</span>}
    </div>
  );
}

export function Pill({ label, color, title }: { label: string; color: string; title?: string }) {
  return (
    <span title={title} style={{ fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.08em", padding: "0.18rem 0.5rem", borderRadius: "3px", background: color, color: B.white, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

export function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} style={{ display: "inline-block", padding: "0.08rem 0.4rem", marginRight: "0.3rem", borderRadius: "3px", fontSize: "0.7rem", fontFamily: mono, border: "1px solid currentColor", opacity: 0.75, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

export function button(kind: "primary" | "danger" | "plain", disabled = false): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "0.42rem 0.8rem",
    fontSize: "0.78rem",
    fontWeight: 700,
    borderRadius: "5px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    border: `1px solid ${B.hairDark}`,
    background: "transparent",
    color: "inherit",
  };
  if (kind === "primary") return { ...base, background: B.red, borderColor: B.red, color: B.white };
  if (kind === "danger") return { ...base, borderColor: B.red, color: B.red };
  return base;
}

export const input: React.CSSProperties = {
  padding: "0.45rem 0.6rem",
  fontSize: "0.85rem",
  borderRadius: "5px",
  border: `1px solid ${B.hairDark}`,
  background: "transparent",
  color: "inherit",
};

export const verdictColor = (v: string): string => (v === "BUILD" ? B.green : v === "WATCH" ? B.amber : B.slate);
