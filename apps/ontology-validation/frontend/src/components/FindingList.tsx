import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Finding } from "../api";
import { SeverityBadge, AuthorityBadge } from "./ui/Badge";
import { JudgeBox } from "./ui/JudgeBox";
import { SourceBlock } from "./SourceBlock";
import { authorityOf, type Severity } from "../lib/semantics";

/** 页面内紧凑 finding 列表（非收件箱：不分组、含内联 judge 框 + 可展开原始条目）。 */
export function FindingList({ findings, empty = "无 findings", dataset }: {
  findings: Finding[]; empty?: string; dataset?: string;
}) {
  if (!findings.length) return <div className="px-1 py-2 text-xs text-[var(--fg-subtle)]">{empty}</div>;
  return (
    <div className="flex flex-col divide-y divide-[var(--border)]">
      {findings.map((f) => <Item key={f.id} f={f} dataset={dataset} />)}
    </div>
  );
}

function Item({ f, dataset }: { f: Finding; dataset?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2">
        <SeverityBadge severity={f.severity as Severity} />
        <AuthorityBadge authority={authorityOf(f.validator_id)} showLabel={false} />
        <span className="mono text-xs text-[var(--fg-muted)]">{String(f.object_id).split("#").pop()}</span>
        {dataset && (
          <button onClick={() => setOpen((o) => !o)}
            className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-[var(--fg-subtle)] hover:text-[var(--accent)]">
            <ChevronRight size={11} className={open ? "rotate-90 transition-transform" : "transition-transform"} />
            原始条目
          </button>
        )}
      </div>
      <div className="mt-1 text-[13px]">{f.message}</div>
      {open && dataset && (
        <div className="mt-2">
          <SourceBlock dataset={dataset} objectType={f.object_type} objectId={f.object_id} />
        </div>
      )}
      {f.judge_verdict && (
        <JudgeBox verdict={f.judge_verdict} confidence={f.judge_confidence ?? undefined}
                  rationale={f.judge_rationale ?? undefined} repair={f.repair} />
      )}
    </div>
  );
}
