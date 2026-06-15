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

/** 由 validator_id 推断层与权限（与后端 registry 对齐的前端镜像）。 */
export function authorityOf(validatorId: string): Authority {
  if (validatorId.startsWith("v5.")) return "advise";
  if (validatorId === "v0.structure" || validatorId === "v2.shacl_minimal") return "veto";
  return "score";
}

export function layerOf(validatorId: string): string {
  const m = validatorId.match(/^v(\d)/);
  return m ? `V${m[1]}` : "V0";
}

export const LAYER_NAME: Record<string, string> = {
  V0: "V0 结构", V1: "V1 Schema", V2: "V2 实例",
  V3: "V3 规则", V4: "V4 流程", V5: "V5 LLM Judge",
};
