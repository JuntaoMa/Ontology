import type { ReactNode } from "react";
import { SEVERITY, AUTHORITY, type Severity, type Authority } from "../../lib/semantics";

/** 严重度徽章：填充色编码（实心软底 + 文字主色）。 */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity] ?? SEVERITY.info;
  const Icon = s.Icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ background: s.soft, color: s.color }}>
      <Icon size={11} /> {s.label}
    </span>
  );
}

/** 权限徽章：图标 + 描边编码（不与严重度抢填充）。 */
export function AuthorityBadge({ authority, showLabel = true }: { authority: Authority; showLabel?: boolean }) {
  const a = AUTHORITY[authority] ?? AUTHORITY.score;
  const Icon = a.Icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[11px] font-medium"
          style={{ borderColor: a.color, color: a.color }} title={a.desc}>
      <Icon size={11} /> {showLabel && a.label}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" }) {
  const map = {
    neutral: "bg-[var(--surface-2)] text-[var(--fg-muted)]",
    accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
    ok: "bg-[var(--ok-soft)] text-[var(--ok)]",
  } as const;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${map[tone]}`}>{children}</span>;
}
