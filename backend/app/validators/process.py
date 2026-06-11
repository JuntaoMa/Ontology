"""V4 流程层（score）：结构检查 + Petri soundness + 双仿真 + 规则×流程交叉验证环。

三种检查的分工（TP §2.8/§2.9）：
- check_soundness（形式）：死锁/不可达/不当终止——控制流级，数据无关；
- pm4py play-out（控制流仿真）：分支随机走，量"结构上可达什么"；
- 数据感知仿真（自写）：按 gateway 条件走真实 case 数据，量"数据上会发生什么"；
  二者覆盖率的差值本身就是信号（AC-P-DEADBRANCH：结构可达、数据不可达）。
交叉验证环：hard 规则派生 Declare 约束跑在数据感知 trace 上（AC-P-CROSS）。
"""
from __future__ import annotations

import warnings

from ..engines.petri_builder import build_petri
from ..engines.simulator import (activity_coverage, check_constraints,
                                 derive_constraints, simulate)
from ..models import Finding, ProcessIR, RuleSet, ValidationResult
from ..orchestrator import Context


def _active_processes(ctx: Context) -> list[ProcessIR]:
    return [ProcessIR.model_validate(raw)
            for pid, raw in ctx.bundle.processes.items()
            if pid not in ctx.quarantined]


def validate_process_formal(ctx: Context) -> ValidationResult:
    """结构纯函数检查 + pm4py check_soundness。"""
    import pm4py

    findings: list[Finding] = []
    metrics: dict = {}
    for ir in _active_processes(ctx):
        kinds = ir.node_kinds()
        # 结构检查：start/ends 必须是 step；孤立节点
        referenced = {e.from_ for e in ir.edges} | {e.to for e in ir.edges}
        isolated = [n for n in kinds if n not in referenced]
        if kinds.get(ir.start) != "step" or any(kinds.get(e) != "step" for e in ir.ends):
            findings.append(Finding(
                validator_id="v4.formal", severity="violation",
                object_type="process", object_id=ir.process_id,
                finding_type="bad_start_end",
                message="start/ends 必须是步骤节点", locus={}))
            continue
        for n in isolated:
            findings.append(Finding(
                validator_id="v4.formal", severity="warning",
                object_type="process", object_id=ir.process_id,
                finding_type="isolated_node",
                message=f"节点 {n} 未被任何边引用", locus={"node": n}))

        net, im, fm = build_petri(ir)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            is_sound, diagnostics = pm4py.check_soundness(net, im, fm)
        metrics[ir.process_id] = {"sound": is_sound}
        if not is_sound:
            def _truthy(v):
                try:
                    return bool(v)
                except ValueError:          # numpy 数组等
                    return getattr(v, "size", len(v) if hasattr(v, "__len__") else 0) > 0
            diag_keys = ([k for k, v in diagnostics.items() if _truthy(v)]
                         if isinstance(diagnostics, dict) else [])
            findings.append(Finding(
                validator_id="v4.formal", severity="violation",
                object_type="process", object_id=ir.process_id,
                finding_type="process_unsound",
                message=f"流程不满足 soundness（存在死锁/不可达/不当终止），诊断项：{diag_keys[:6]}",
                locus={"diagnostics": [str(k) for k in diag_keys][:10]}))
    return ValidationResult(
        verdict="fail" if any(f.severity == "violation" for f in findings) else "pass",
        findings=findings, metrics=metrics)


def validate_process_simulation(ctx: Context) -> ValidationResult:
    """数据感知仿真覆盖率 + 与控制流 play-out 的对照。"""
    from pm4py.algo.simulation.playout.petri_net import algorithm as playout_alg

    if ctx.bundle.rules is None:
        return ValidationResult("pass")
    ruleset = RuleSet.model_validate(ctx.bundle.rules)
    n_cases = int(ctx.config.get("v4.simulation", {}).get("n_cases", 300))

    findings: list[Finding] = []
    metrics: dict = {}
    for ir in _active_processes(ctx):
        traces = simulate(ir, ruleset, n_cases=n_cases)
        completed = [t for t in traces if t.completed]
        cov = activity_coverage(ir, completed)
        zero_data = sorted(a for a, n in cov.items() if n == 0)

        # 控制流 play-out（仅对 sound 流程，作对照指标）
        sound = (ctx.results.get("v4.formal") and
                 ctx.results["v4.formal"].metrics.get(ir.process_id, {}).get("sound"))
        cf_covered: set[str] = set()
        if sound:
            try:
                net, im, fm = build_petri(ir)
                log = playout_alg.apply(net, im, variant=playout_alg.Variants.BASIC_PLAYOUT,
                                        parameters={"noTraces": 200, "maxTraceLength": 100})
                name_by_label = {s.name: s.id for s in ir.steps}
                for tr in log:
                    for ev in tr:
                        lbl = ev["concept:name"]
                        if lbl in name_by_label:
                            cf_covered.add(name_by_label[lbl])
            except Exception:
                pass

        coverage_pct = (100.0 * sum(1 for n in cov.values() if n > 0) / len(cov)) if cov else 0
        metrics[ir.process_id] = {
            "cases": len(traces), "completed": len(completed),
            "data_coverage_pct": round(coverage_pct, 1),
            "zero_activities_data": zero_data,
            "cf_playout_covered": sorted(cf_covered)}

        for act in zero_data:
            cf_reachable = act in cf_covered
            findings.append(Finding(
                validator_id="v4.simulation", severity="warning",
                object_type="process", object_id=ir.process_id,
                finding_type="dead_activity_data",
                message=(f"活动「{act}」在 {len(completed)} 条数据感知 trace 中 0 次执行"
                         + ("（控制流 play-out 可达——条件在数据上不可满足）" if cf_reachable else "")),
                locus={"activity": act, "cf_reachable": cf_reachable}))

    return ValidationResult(
        verdict="fail" if findings else "pass", findings=findings, metrics=metrics)


def validate_cross(ctx: Context) -> ValidationResult:
    """V3×V4 交叉验证环：规则派生约束 × 仿真 trace（AC-P-CROSS）。"""
    if ctx.bundle.rules is None:
        return ValidationResult("pass")
    ruleset = RuleSet.model_validate(ctx.bundle.rules)
    n_cases = int(ctx.config.get("v4.simulation", {}).get("n_cases", 300))

    findings: list[Finding] = []
    for ir in _active_processes(ctx):
        constraints = derive_constraints(ruleset, ir)
        if not constraints:
            continue
        traces = simulate(ir, ruleset, n_cases=n_cases)
        violations = check_constraints(constraints, traces)
        for cid, bad in violations.items():
            c = next(c for c in constraints if c.constraint_id == cid)
            rule = next(r for r in ruleset.rules if r.rule_id == c.source_rule)
            sample = bad[0]
            findings.append(Finding(
                validator_id="v4.cross", severity="violation",
                object_type="process", object_id=ir.process_id,
                finding_type="cross_validation_violation",
                message=(f"流程与规则 {c.source_rule} 矛盾：{len(bad)} 条 trace 满足"
                         f"「{c.condition}」却未经过活动「{c.activity}」"),
                locus={"constraint": cid, "source_rule": c.source_rule,
                       "violating_traces": len(bad),
                       "sample_case": {"data": sample.data,
                                       "activities": sample.activities}},
                evidence={"rule_quote": rule.evidence[0].quote}))
    return ValidationResult(
        verdict="fail" if findings else "pass", findings=findings)
