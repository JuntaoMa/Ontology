/** 双语义轴的统一编码（严重度=填充色，权限=图标+边框）。
 *  全应用任何呈现 finding 的地方都从这里取，保证 AC-UI-LEGEND 一致。 */
import { Scale, ShieldX, Info, AlertTriangle, CircleAlert } from "lucide-react";
import type { ComponentType } from "react";

export type Severity = "violation" | "warning" | "info";
export type Authority = "veto" | "score" | "advise";

export const SEVERITY: Record<Severity, { label: string; color: string; soft: string; Icon: ComponentType<any> }> = {
  violation: { label: "violation", color: "var(--sev-violation)", soft: "var(--sev-violation-soft)", Icon: CircleAlert },
  warning:   { label: "warning",   color: "var(--sev-warning)",   soft: "var(--sev-warning-soft)",   Icon: AlertTriangle },
  info:      { label: "info",      color: "var(--sev-info)",      soft: "var(--sev-info-soft)",      Icon: Info },
};

export const AUTHORITY: Record<Authority, { label: string; desc: string; color: string; Icon: ComponentType<any> }> = {
  veto:   { label: "veto",   desc: "直接否决 · 进 quarantine", color: "var(--authority-veto)",   Icon: ShieldX },
  score:  { label: "score",  desc: "负证据 finding · 不删数据", color: "var(--authority-score)",  Icon: CircleAlert },
  advise: { label: "advise", desc: "LLM 辅助裁决 · 不可否决",   color: "var(--authority-advise)", Icon: Scale },
};

/** 由 validator_id 推断类别与权限（与后端 registry 对齐的前端镜像，spec 20）。
 *  id 形如 <category>.<purpose>，类别即前缀；权限按显式集合（category 不足以决定，
 *  如 schema 既有 score 的 consistency 又有 advise 的 semantic）。 */
const VETO = new Set(["intake.structure", "instance.required-fields"]);
const ADVISE = new Set(["schema.semantic", "cross.faithfulness", "meta.review"]);

export function authorityOf(validatorId: string): Authority {
  if (ADVISE.has(validatorId)) return "advise";
  if (VETO.has(validatorId)) return "veto";
  return "score";
}

/** 类别 = id 的命名空间前缀（intake/schema/instance/rule/process/cross/meta）。 */
export function categoryOf(validatorId: string): string {
  return validatorId.split(".")[0];
}

export const CATEGORY_NAME: Record<string, string> = {
  intake: "句法入口", schema: "本体", instance: "实例",
  rule: "规则", process: "流程", cross: "跨域", meta: "复判",
};

/** 校验器目的名（界面标签的单一来源）。 */
export const LABEL: Record<string, string> = {
  "intake.structure": "结构完整性",
  "instance.required-fields": "必填底线", "instance.data-quality": "数据质量",
  "instance.competency": "能力问题",
  "schema.consistency": "逻辑一致性", "schema.pitfalls": "建模坏味道",
  "schema.semantic": "语义合理性",
  "rule.defects": "规则集缺陷",
  "process.soundness": "流程健全性", "process.simulation": "数据感知仿真",
  "cross.rule-process": "规则×流程一致", "cross.faithfulness": "抽取忠实性",
  "meta.review": "复判收口",
};
