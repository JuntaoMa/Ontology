"""J2 抽取忠实性 judge（advise）：形式化产物 vs evidence 原文。

确定性引擎的盲区：IR 在逻辑上自洽，但与抽取来源不符
（AC-R-FAITH 数量级抽错；AC-P-FAITH 边方向与原文相反）。
"""
from __future__ import annotations

import json

from ..models import Finding, ProcessIR, RuleSet, ValidationResult
from ..orchestrator import Context
from .base import run_judge

SYSTEM = """你是知识抽取的质检专家。给你一组「形式化结果 + 其抽取来源的原文引文」，
逐条判断形式化是否**忠实于原文**：
- 数值与数量级（注意中文数词：五千/5万/50万…）；
- 比较方向与边界（以上/以下/超过/不低于…）；
- 顺序与方向（先A后B、A完成后进入B…对应 流程边 from→to）；
- 条件范围与结论动作是否与原文一致。
不要评判规则本身合不合理，只比对形式化与原文的一致性。
verdict 取值：issue_found（与原文不符）/ no_issue / uncertain。
dimensions 至少包含 {"数值一致": bool, "方向顺序一致": bool}。"""


def judge_faithfulness(ctx: Context) -> ValidationResult:
    if not (ctx.config.get("judge", {}).get("enabled")):
        return ValidationResult("pass", metrics={"skipped": "judge disabled"})

    items: list[dict] = []
    material: dict[str, str] = {}

    if ctx.bundle.rules is not None:
        ruleset = RuleSet.model_validate(ctx.bundle.rules)
        for r in ruleset.rules:
            if r.rule_id in ctx.quarantined:
                continue
            item_id = f"rule:{r.rule_id}"
            formal = (f"规则 {r.rule_id}：guard「{r.guard}」 ⇒ "
                      f"{r.conclusion.action}（{r.conclusion.polarity}，tier={r.tier}）")
            quotes = "；".join(e.quote for e in r.evidence)
            items.append({"item_id": item_id, "formal": formal, "evidence_quote": quotes})
            material[item_id] = formal + "\n原文：" + quotes

    name_of: dict[str, dict[str, str]] = {}
    for pid, raw in ctx.bundle.processes.items():
        if pid in ctx.quarantined:
            continue
        ir = ProcessIR.model_validate(raw)
        name_of[pid] = {s.id: s.name for s in ir.steps}
        for e in ir.edges:
            frm = f"{e.from_}({name_of[pid].get(e.from_, e.from_)})"
            to = f"{e.to}({name_of[pid].get(e.to, e.to)})"
            item_id = f"edge:{pid}:{e.from_}→{e.to}"
            formal = f"流程边：{frm} → {to}" + (f"，条件「{e.condition}」" if e.condition else "")
            quotes = "；".join(ev.quote for ev in e.evidence)
            items.append({"item_id": item_id, "formal": formal, "evidence_quote": quotes})
            material[item_id] = formal + "\n原文：" + quotes

    if not items:
        return ValidationResult("pass")

    prompt = ("逐条比对以下形式化结果与其原文引文的忠实性：\n"
              + json.dumps(items, ensure_ascii=False, indent=1))
    out, meta = run_judge(judge_id="j2_faithfulness", system=SYSTEM, prompt=prompt,
                          source_material=material, conn=ctx.conn, config=ctx.config)

    findings: list[Finding] = []
    if out is not None:
        for item in out.items:
            if item.verdict != "issue_found":
                continue
            if item.item_id.startswith("rule:"):
                otype, oid = "rule", item.item_id.split(":", 1)[1]
            else:
                _, pid, edge = item.item_id.split(":", 2)
                otype, oid = "process", pid
            findings.append(Finding(
                validator_id="v5.j2", severity="warning",
                object_type=otype, object_id=oid,
                finding_type="unfaithful_extraction",
                message=f"形式化与原文不符：{item.rationale}",
                locus={"item": item.item_id, "dimensions": item.dimensions,
                       "confidence": item.confidence, "cited": item.cited_evidence},
                evidence={"repair_suggestion": item.repair_suggestion}))
    return ValidationResult(
        verdict="pass" if not findings else "fail",
        findings=findings,
        metrics={"backend": meta.backend, "cached": meta.cached,
                 "tokens_in": meta.tokens_in, "tokens_out": meta.tokens_out,
                 "downgraded": meta.downgraded, "abstained": out is None,
                 "items": len(items)})
