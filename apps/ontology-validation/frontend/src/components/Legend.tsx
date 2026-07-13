import { SEVERITY, AUTHORITY, type Severity, type Authority } from "../lib/semantics";

/** 双语义轴常驻图例（AC-UI-LEGEND）。 */
export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-[var(--fg-subtle)]">
      <span className="font-medium text-[var(--fg-muted)]">严重度（填充）</span>
      {(Object.keys(SEVERITY) as Severity[]).map((k) => {
        const s = SEVERITY[k];
        return (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        );
      })}
      <span className="ml-2 font-medium text-[var(--fg-muted)]">权限（图标+边框）</span>
      {(Object.keys(AUTHORITY) as Authority[]).map((k) => {
        const a = AUTHORITY[k]; const Icon = a.Icon;
        return (
          <span key={k} className="inline-flex items-center gap-1" style={{ color: a.color }} title={a.desc}>
            <Icon size={12} /> {a.label}
          </span>
        );
      })}
    </div>
  );
}
