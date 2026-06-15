import type { Finding } from "../api";
import { SeverityBadge, AuthorityBadge } from "./ui/Badge";
import { JudgeBox } from "./ui/JudgeBox";
import { authorityOf, type Severity } from "../lib/semantics";

/** 页面内紧凑 finding 列表（非收件箱：不分组、含内联 judge 框）。 */
export function FindingList({ findings, empty = "无 findings" }: { findings: Finding[]; empty?: string }) {
  if (!findings.length) return <div className="px-1 py-2 text-xs text-[var(--fg-subtle)]">{empty}</div>;
  return (
    <div className="flex flex-col divide-y divide-[var(--border)]">
      {findings.map((f) => (
        <div key={f.id} className="py-2.5">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={f.severity as Severity} />
            <AuthorityBadge authority={authorityOf(f.validator_id)} showLabel={false} />
            <span className="mono text-xs text-[var(--fg-muted)]">{String(f.object_id).split("#").pop()}</span>
          </div>
          <div className="mt-1 text-[13px]">{f.message}</div>
          {f.judge_verdict && (
            <JudgeBox verdict={f.judge_verdict} confidence={f.judge_confidence ?? undefined}
                      rationale={f.judge_rationale ?? undefined} repair={f.repair} />
          )}
        </div>
      ))}
    </div>
  );
}
