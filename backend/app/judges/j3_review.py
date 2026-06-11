"""J3 finding 复判 + 修复起草（advise）：只接 ambiguous 带（AC-J-ROUTE）。

verdict 语义：
- confirm（确认是真问题）∧ confidence≥τ → 队列折叠为低交互项；
- likely_false_positive ∧ confidence≥τ → 降权折叠；
- uncertain → 维持人工。
折叠 ≠ 自动通过：finding 仍在队列可见可展开，写入闸门终审在人（advise 边界）。
对 cq_failed 额外输出 classification ∈ {ontology_gap, data_gap, cq_outdated, regression}。
"""
from __future__ import annotations

import json

from ..models import ValidationResult
from ..orchestrator import Context
from .base import run_judge

# 路由白名单：可复判的 ambiguous 带（AC-J-ROUTE）
ROUTABLE_TYPES = {
    "shacl_enum", "shacl_datatype", "shacl_min_inclusive", "shacl_max_inclusive",
    "shacl_min_exclusive", "shacl_max_count", "shacl_class_range",
    "cq_failed", "competing_suggestion", "rule_subsumed", "coverage_gap",
    "dead_activity_data", "missing_label", "missing_domain_range", "subclass_cycle",
}
# 终审型确定性结论：明确不送复判
EXCLUDED_TYPES = {
    "rule_conflict", "dead_rule", "process_unsound", "disjoint_violation",
    "cross_validation_violation", "member_of_nothing", "shacl_min_count",
    "structural_invalid", "dangling_edge",
}

SYSTEM = """你是知识校验系统的复审专家。给你一组由确定性校验器产出的 finding，
逐条复判并起草修复建议：
- verdict=confirm：确实是需要处理的问题；
- verdict=likely_false_positive：大概率误报或可忽略（说明原因）；
- verdict=uncertain：需要人工判断。
若能给出具体修复（如枚举笔误的正确值、缺失声明的补法），写入 repair_suggestion。
对 finding_type=cq_failed 的条目，额外在 classification 给出失败三分类提议：
ontology_gap（本体缺口）/ data_gap（数据缺口）/ cq_outdated（CQ 过时）/ regression（本体回退）。
dimensions 至少包含 {"是真问题": bool}。"""


def routable(row) -> bool:
    return (row["finding_type"] in ROUTABLE_TYPES
            and row["finding_type"] not in EXCLUDED_TYPES
            and not row["validator_id"].startswith("v5."))


def judge_review(ctx: Context) -> ValidationResult:
    cfg = ctx.config.get("judge", {})
    if not cfg.get("enabled") or cfg.get("j3") is False:
        return ValidationResult("pass", metrics={"skipped": "judge disabled"})
    tau = float(cfg.get("tau", 0.85))

    rows = ctx.conn.execute(
        "SELECT * FROM findings WHERE run_id=? AND status='open'", (ctx.run_id,)).fetchall()
    n_before = len(rows)
    routed = [r for r in rows if routable(r)]

    if not routed:
        return ValidationResult("pass", metrics={"n_before": n_before, "routed": 0,
                                                 "n_after": n_before})

    # Z3 等求解器产生的反例样本跨运行可变，不能进 judge 输入
    # （否则 input_hash 漂移导致 cassette 永不命中）
    _VOLATILE_LOCUS = {"uncovered_sample", "counterexample", "overlap_example"}

    items, material = [], {}
    for r in routed:
        item_id = str(r["id"])
        locus = {k: v for k, v in json.loads(r["locus_json"] or "{}").items()
                 if k not in _VOLATILE_LOCUS}
        text = (f"[{r['validator_id']}/{r['finding_type']}/{r['severity']}] "
                f"对象 {r['object_id']}：{r['message']}"
                + (f"；定位 {json.dumps(locus, ensure_ascii=False, sort_keys=True)}"
                   if locus else ""))
        items.append({"item_id": item_id, "finding_type": r["finding_type"],
                      "finding": text})
        material[item_id] = text

    prompt = ("逐条复判以下确定性校验 finding：\n"
              + json.dumps(items, ensure_ascii=False, indent=1))
    out, meta = run_judge(judge_id="j3_review", system=SYSTEM, prompt=prompt,
                          source_material=material, conn=ctx.conn, config=ctx.config)

    folded = 0
    if out is not None:
        for item in out.items:
            try:
                fid = int(item.item_id)
            except ValueError:
                continue
            # advise 权限边界：只写 judge_* 与 repair 列（AC-ORCH-3）
            repair = (json.dumps({"suggestion": item.repair_suggestion,
                                  "classification": item.classification},
                                 ensure_ascii=False)
                      if (item.repair_suggestion or item.classification) else None)
            ctx.conn.execute(
                "UPDATE findings SET judge_verdict=?, judge_confidence=?, "
                "judge_rationale=?, repair_json=? WHERE id=? AND run_id=?",
                (item.verdict, item.confidence, item.rationale, repair, fid, ctx.run_id))
            if (item.verdict in ("confirm", "likely_false_positive")
                    and item.confidence >= tau):
                folded += 1
        ctx.conn.commit()

    n_after = n_before - folded
    return ValidationResult(
        verdict="pass",
        metrics={"backend": meta.backend, "cached": meta.cached,
                 "tokens_in": meta.tokens_in, "tokens_out": meta.tokens_out,
                 "abstained": out is None, "routed": len(routed),
                 "n_before": n_before, "folded": folded, "n_after": n_after,
                 "saving_pct": round(100 * folded / n_before, 1) if n_before else 0.0,
                 "tau": tau})
