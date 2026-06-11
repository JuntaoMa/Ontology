"""V3 规则层（score）：Z3 缺陷检测 + tier 分级语义（TP §2.10.2/§2.10.3）。

缺陷 → SMT query 对照（demo 实现四类 + tier 语义）：
  conflict    : SAT(domain ∧ g_i ∧ g_j ∧ incompatible(c_i,c_j))，hard×hard → violation
  competing   : 同上但任一方为 heuristic → info「竞争建议」，不是错误（AC-R-COMPETE）
  dead rule   : UNSAT(domain ∧ g_i)
  subsumption : UNSAT(domain ∧ g_i ∧ ¬g_j) 且结论一致 → i 被 j 吞
  gap         : SAT(domain ∧ ¬⋁ hard guards) → 给出具体未覆盖样例
"""
from __future__ import annotations

from fractions import Fraction

import z3

from ..engines.guard_parser import make_z3_vars, parse_guard, to_z3
from ..models import Finding, RuleSet, ValidationResult
from ..orchestrator import Context


def _model_values(model: z3.ModelRef, zvars: dict) -> dict[str, float | int]:
    out: dict[str, float | int] = {}
    for name, v in zvars.items():
        val = model.eval(v, model_completion=True)
        if z3.is_int_value(val):
            out[name] = val.as_long()
        else:
            frac = Fraction(val.as_fraction())
            out[name] = float(frac)
    return out


def validate_rules(ctx: Context) -> ValidationResult:
    if ctx.bundle.rules is None:
        return ValidationResult("pass")
    ruleset = RuleSet.model_validate(ctx.bundle.rules)
    # quarantine 过滤（v0 结构失败的规则不参与形式化校验）
    rules = [r for r in ruleset.rules if r.rule_id not in ctx.quarantined]

    zvars, domain = make_z3_vars(
        {k: v.model_dump() for k, v in ruleset.variables.items()})
    guards = {r.rule_id: to_z3(parse_guard(r.guard), zvars) for r in rules}
    incompatible = {frozenset(p) for p in ruleset.incompatible_actions}
    findings: list[Finding] = []

    def check(*assumptions) -> tuple[str, z3.ModelRef | None]:
        s = z3.Solver()
        s.add(*domain, *assumptions)
        res = s.check()
        return str(res), (s.model() if res == z3.sat else None)

    # ---- dead rules ----
    dead: set[str] = set()
    for r in rules:
        res, _ = check(guards[r.rule_id])
        if res == "unsat":
            dead.add(r.rule_id)
            findings.append(Finding(
                validator_id="v3.rules", severity="violation",
                object_type="rule", object_id=r.rule_id,
                finding_type="dead_rule",
                message=f"规则 {r.rule_id} 的 guard 在变量定义域内永假（永不触发）",
                locus={"guard": r.guard},
                evidence={"quotes": [e.quote for e in r.evidence]}))

    live = [r for r in rules if r.rule_id not in dead]

    # ---- conflict / competing ----
    for i, ra in enumerate(live):
        for rb in live[i + 1:]:
            if frozenset({ra.conclusion.action, rb.conclusion.action}) not in incompatible:
                continue
            res, model = check(guards[ra.rule_id], guards[rb.rule_id])
            if res != "sat":
                continue
            counterexample = _model_values(model, zvars)
            both_hard = ra.tier == "hard" and rb.tier == "hard"
            if both_hard:
                findings.append(Finding(
                    validator_id="v3.rules", severity="violation",
                    object_type="rule", object_id=f"{ra.rule_id}×{rb.rule_id}",
                    finding_type="rule_conflict",
                    message=(f"hard 规则冲突：{ra.rule_id}({ra.conclusion.action}) 与 "
                             f"{rb.rule_id}({rb.conclusion.action}) 在同一输入下同时触发"),
                    locus={"rule_a": ra.rule_id, "rule_b": rb.rule_id,
                           "counterexample": counterexample},
                    evidence={"quote_a": ra.evidence[0].quote,
                              "quote_b": rb.evidence[0].quote}))
            else:
                findings.append(Finding(
                    validator_id="v3.rules", severity="info",
                    object_type="rule", object_id=f"{ra.rule_id}×{rb.rule_id}",
                    finding_type="competing_suggestion",
                    message=(f"竞争建议（heuristic 常态，非错误）：{ra.rule_id} 建议 "
                             f"{ra.conclusion.action}，{rb.rule_id} 建议 {rb.conclusion.action}"),
                    locus={"rule_a": ra.rule_id, "rule_b": rb.rule_id,
                           "overlap_example": counterexample}))

    # ---- subsumption（跳过 dead，避免空真） ----
    for ra in live:
        for rb in live:
            if ra.rule_id == rb.rule_id:
                continue
            if (ra.conclusion.action != rb.conclusion.action
                    or ra.conclusion.polarity != rb.conclusion.polarity):
                continue
            res, _ = check(guards[ra.rule_id], z3.Not(guards[rb.rule_id]))
            if res == "unsat":
                findings.append(Finding(
                    validator_id="v3.rules", severity="warning",
                    object_type="rule", object_id=ra.rule_id,
                    finding_type="rule_subsumed",
                    message=f"规则 {ra.rule_id} 被 {rb.rule_id} 蕴含（guard 更窄、结论相同），冗余",
                    locus={"subsumed": ra.rule_id, "by": rb.rule_id}))

    # ---- coverage gap（只算 hard 决策规则） ----
    hard_guards = [guards[r.rule_id] for r in live if r.tier == "hard"]
    if hard_guards:
        res, model = check(z3.Not(z3.Or(*hard_guards)))
        if res == "sat":
            findings.append(Finding(
                validator_id="v3.rules", severity="warning",
                object_type="rule", object_id=ruleset.ruleset_id,
                finding_type="coverage_gap",
                message="存在 hard 规则未覆盖的输入区域（该区域内无任何决策规则触发）",
                locus={"uncovered_sample": _model_values(model, zvars)}))

    return ValidationResult(
        verdict="fail" if any(f.severity == "violation" for f in findings) else "pass",
        findings=findings,
        metrics={"rules_total": len(rules), "dead": len(dead)})
