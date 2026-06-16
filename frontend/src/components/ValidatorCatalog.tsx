import type { Finding } from "../api";

/** 展示一个/多个校验器的「完整检查清单」（不只违例项）。
 *  SHACL 解析为「目标类 × 路径 × 约束」表，本次被触发的行标红。 */
export function ValidatorCatalog({ specs, validatorIds, findings }: {
  specs: Record<string, any> | null;
  validatorIds: string[];
  findings: Finding[];
}) {
  if (!specs) return <div className="py-1 text-[11px] text-[var(--fg-subtle)]">加载检查清单中…</div>;
  return (
    <div className="flex flex-col gap-3">
      {validatorIds.map((id) => {
        const s = specs[id];
        if (!s) return null;
        const violatedPaths = new Set(
          findings.filter((f) => f.validator_id === id)
            .map((f) => String(f.locus?.path || "").split("#").pop()).filter(Boolean));
        return (
          <div key={id}>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold">{s.title}</span>
              <span className="mono text-[10px] text-[var(--fg-subtle)]">{id}</span>
            </div>
            <div className="mb-1 text-[11px] text-[var(--fg-subtle)]">{s.desc}</div>
            {s.kind === "shacl" ? (
              <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)]">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-[var(--surface-2)] text-[var(--fg-muted)]">
                      <th className="px-2 py-1 text-left font-medium">目标类</th>
                      <th className="px-2 py-1 text-left font-medium">属性路径</th>
                      <th className="px-2 py-1 text-left font-medium">约束</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.shacl.map((c: any, i: number) => {
                      const hit = violatedPaths.has(c.path);
                      return (
                        <tr key={i} className="border-t border-[var(--border)]"
                            style={hit ? { background: "var(--sev-violation-soft)" } : undefined}>
                          <td className="mono px-2 py-1 align-top">{c.target_class}</td>
                          <td className="mono px-2 py-1 align-top"
                              style={hit ? { color: "var(--sev-violation)", fontWeight: 600 } : undefined}>
                            {c.path}{hit && " ⚠"}
                          </td>
                          <td className="mono px-2 py-1 align-top text-[var(--fg-muted)]">{c.constraints.join("；")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {s.checks.map((c: any, i: number) => (
                  <li key={i} className="flex gap-2 text-[11px]">
                    <span className="mono shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--fg-muted)]">{c.label}</span>
                    <span className="text-[var(--fg-muted)]">{c.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
