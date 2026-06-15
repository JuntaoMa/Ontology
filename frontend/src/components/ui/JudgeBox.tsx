import { Scale } from "lucide-react";

/** judge 复判结果框：verdict + 置信度 + rationale + 修复建议/分类。advise 紫色边。 */
export function JudgeBox({ verdict, confidence, rationale, repair }: {
  verdict: string; confidence?: number; rationale?: string;
  repair?: { suggestion?: string | null; classification?: string | null } | null;
}) {
  const fp = verdict === "likely_false_positive";
  const tone = fp ? "var(--sev-warning)" : verdict === "confirm" ? "var(--ok)" : "var(--authority-advise)";
  return (
    <div className="mt-2 rounded-[var(--radius-sm)] border-l-2 bg-[var(--authority-advise-soft)] px-2.5 py-2 text-xs"
         style={{ borderColor: tone }}>
      <div className="flex items-center gap-1 font-medium" style={{ color: tone }}>
        <Scale size={12} /> judge：{verdict}
        {confidence != null && <span className="text-[var(--fg-subtle)]">（{(confidence * 100).toFixed(0)}%）</span>}
      </div>
      {rationale && <div className="mt-1 text-[var(--fg-muted)]">{rationale}</div>}
      {repair?.suggestion && <div className="mt-1">🔧 修复：{repair.suggestion}</div>}
      {repair?.classification && <div className="mt-0.5">📋 分类提议：{repair.classification}</div>}
    </div>
  );
}
