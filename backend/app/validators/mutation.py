"""错误注入实验室（横切，TP §2.9.5）：变异算子 → 全管线重跑 → 捕获率矩阵。

捕获判定：mutant 运行相对 baseline 出现【新增】finding/quarantine 的层。
矩阵三类格局（specs AC-MUT-*）：
- 形式型变异 → 确定性层捕获；
- 语义/忠实性变异 → 仅 V5 LLM judge 捕获（mutation 运行只开 j1/j2，j3 是复审不是检测）；
- mut_remove_disjoint → 全层 miss（故意保留的盲区：删掉约束后无人知道约束本该存在）。
"""
from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field

from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import OWL, RDFS, XSD

from .. import store
from ..datasets import Bundle
from ..orchestrator import Registry, run_pipeline

EX = Namespace("http://example.org/loan#")
LAYERS = ["V0", "V1", "V2", "V3", "V4", "V5"]


@dataclass
class MutationOp:
    op_id: str
    description: str
    target: str                      # instance | ontology | rule | process
    expected_layers: list[str]       # 期望捕获层；[] = 预期盲区
    needs_judge: bool = False


@dataclass
class MutationResult:
    op_id: str
    expected_layers: list[str]
    captured_layers: list[str] = field(default_factory=list)
    new_findings: list[dict] = field(default_factory=list)
    judge_available: bool = True


def _copy_graph(g: Graph) -> Graph:
    out = Graph()
    for t in g:
        out.add(t)
    return out


def _clone(bundle: Bundle, op_id: str) -> Bundle:
    return Bundle(
        dataset_id=bundle.dataset_id, root=bundle.root,
        ontology=_copy_graph(bundle.ontology), data=_copy_graph(bundle.data),
        shapes_minimal=bundle.shapes_minimal, shapes_trusted=bundle.shapes_trusted,
        rules=copy.deepcopy(bundle.rules),
        processes=copy.deepcopy(bundle.processes),
        cqs=bundle.cqs,
        content_hash=f"{bundle.content_hash}+{op_id}")


def _rule(bundle: Bundle, rid: str) -> dict:
    return next(r for r in bundle.rules["rules"] if r["rule_id"] == rid)


OPERATORS: list[MutationOp] = [
    # ---- 实例数据（形式型 → V2） ----
    MutationOp("mut_remove_required", "删除 app010 的 hasApplicant（必填缺失）",
               "instance", ["V2"]),
    MutationOp("mut_enum_invalid", "app010 风险等级改为 URGENT（枚举越界）",
               "instance", ["V2"]),
    MutationOp("mut_negative_value", "p010 年龄改为 -7（范围违例）",
               "instance", ["V2"]),
    # ---- 本体 ----
    MutationOp("mut_remove_disjoint", "删除 Applicant⊥Organization 公理（预期盲区）",
               "ontology", []),
    MutationOp("mut_subclass_cycle", "添加 Document⊑TemporaryEmployee（构成环）",
               "ontology", ["V1"]),
    MutationOp("mut_wrong_parent", "添加 RiskAssessment⊑Employee（语义荒谬、逻辑自洽）",
               "ontology", ["V5"], needs_judge=True),
    # ---- 规则 ----
    MutationOp("mut_flip_operator", "R10 比较算子翻转（>50万 改 <50万）",
               "rule", ["V3", "V4"]),
    MutationOp("mut_drop_guard_clause", "R2 删除受理范围条件（与 R1/R13 产生冲突）",
               "rule", ["V3"]),
    MutationOp("mut_guard_vs_evidence", "R12 金额阈值 10万 改 1万（原文是10万，忠实性）",
               "rule", ["V5"], needs_judge=True),
    # ---- 流程 ----
    MutationOp("mut_xor_to_and", "正常流程 g1 由 XOR 改 AND（结构性 unsound）",
               "process", ["V4"]),
    MutationOp("mut_drop_edge", "删除 auto_approve→notify 边（token 死端）",
               "process", ["V4"]),
    MutationOp("mut_gateway_threshold", "正常流程人工复核阈值 50万 改 90万（违反 R10）",
               "process", ["V4"]),
    MutationOp("mut_edge_evidence_reverse", "完整性检查→风险评估的 evidence 改为相反顺序",
               "process", ["V5"], needs_judge=True),
]


def apply_op(bundle: Bundle, op_id: str) -> Bundle:
    b = _clone(bundle, op_id)
    if op_id == "mut_remove_required":
        b.data.remove((EX.app010, EX.hasApplicant, None))
    elif op_id == "mut_enum_invalid":
        b.data.remove((EX.app010, EX.riskLevel, None))
        b.data.add((EX.app010, EX.riskLevel, Literal("URGENT")))
    elif op_id == "mut_negative_value":
        b.data.remove((EX.p010, EX.age, None))
        b.data.add((EX.p010, EX.age, Literal(-7, datatype=XSD.integer)))
    elif op_id == "mut_remove_disjoint":
        b.data.remove((None, OWL.disjointWith, None))
        b.ontology.remove((None, OWL.disjointWith, None))
    elif op_id == "mut_subclass_cycle":
        for g in (b.data, b.ontology):
            g.add((EX.Document, RDFS.subClassOf, EX.TemporaryEmployee))
    elif op_id == "mut_wrong_parent":
        for g in (b.data, b.ontology):
            g.add((EX.RiskAssessment, RDFS.subClassOf, EX.Employee))
    elif op_id == "mut_flip_operator":
        _rule(b, "R10")["guard"] = "loan_amount < 500000"
    elif op_id == "mut_drop_guard_clause":
        _rule(b, "R2")["guard"] = "monthly_income >= 5000 && loan_amount <= 100000"
    elif op_id == "mut_guard_vs_evidence":
        _rule(b, "R12")["guard"] = "loan_amount > 10000"
    elif op_id == "mut_xor_to_and":
        b.processes["loan_normal"]["gateways"][0]["type"] = "AND"
    elif op_id == "mut_drop_edge":
        edges = b.processes["loan_normal"]["edges"]
        b.processes["loan_normal"]["edges"] = [
            e for e in edges if not (e["from"] == "auto_approve" and e["to"] == "notify")]
    elif op_id == "mut_gateway_threshold":
        for e in b.processes["loan_normal"]["edges"]:
            if e.get("condition") == "loan_amount > 500000":
                e["condition"] = "loan_amount > 900000"
            elif e.get("condition") == "loan_amount <= 500000":
                e["condition"] = "loan_amount <= 900000"
    elif op_id == "mut_edge_evidence_reverse":
        for e in b.processes["loan_normal"]["edges"]:
            if e["from"] == "completeness_check" and e["to"] == "risk_assessment":
                e["evidence"] = [{"quote": "新规要求先完成风险评估，评估通过后再核对材料完整性",
                                  "source": "操作规程§3（修订）"}]
    else:
        raise ValueError(f"unknown operator: {op_id}")
    return b


def _signature(conn, run_id: str) -> set[tuple]:
    rows = conn.execute(
        "SELECT validator_id, finding_type, object_id FROM findings WHERE run_id=?",
        (run_id,)).fetchall()
    sig = {(r["validator_id"], r["finding_type"], r["object_id"]) for r in rows}
    for q in conn.execute("SELECT reason, object_id FROM quarantine WHERE run_id=?",
                          (run_id,)):
        sig.add((q["reason"], "quarantined", q["object_id"]))
    return sig


def _layer_of(validator_id: str, registry: Registry) -> str:
    try:
        return registry.get(validator_id).layer
    except KeyError:
        return "V0"


def run_mutation_lab(bundle: Bundle, registry: Registry, conn,
                     ops: list[str] | None = None,
                     judge_config: dict | None = None) -> list[MutationResult]:
    """对每个算子：注入 → 重跑管线 → 与 baseline 差分 → 归层。"""
    selected = [o for o in OPERATORS if ops is None or o.op_id in ops]

    base_cfg = {"no_cache": True, "judge": {"enabled": False}}
    base_ctx = run_pipeline(bundle, registry, conn, config=base_cfg)
    baseline = _signature(conn, base_ctx.run_id)

    # LLM 算子需要 judge 开启的基线（否则未变异对象上的 judge findings
    # 会被误算成「变异新增」）；cassette 命中时零成本
    judge_baseline: set[tuple] | None = None
    jc_base = dict(judge_config or {})
    jc_base.update({"enabled": True, "j3": False})
    if any(o.needs_judge for o in selected):
        jctx = run_pipeline(bundle, registry, conn,
                            config={"no_cache": True, "judge": jc_base})
        judge_baseline = baseline | _signature(conn, jctx.run_id)

    results: list[MutationResult] = []
    for op in selected:
        mutant = apply_op(bundle, op.op_id)
        cfg = ({"no_cache": True, "judge": jc_base} if op.needs_judge
               else dict(base_cfg))
        ctx = run_pipeline(mutant, registry, conn, config=cfg)
        ref = judge_baseline if op.needs_judge else baseline
        new = _signature(conn, ctx.run_id) - ref

        res = MutationResult(op_id=op.op_id, expected_layers=op.expected_layers)
        for vid, ftype, oid in sorted(new):
            layer = _layer_of(vid, registry)
            if layer not in res.captured_layers:
                res.captured_layers.append(layer)
            res.new_findings.append({"validator": vid, "type": ftype, "object": oid})
        res.captured_layers.sort()
        if op.needs_judge:
            j_metrics = [ctx.results[v].metrics for v in ("v5.j1", "v5.j2")
                         if v in ctx.results]
            res.judge_available = not all(m.get("abstained") for m in j_metrics)
        results.append(res)
    return results


def matrix_json(results: list[MutationResult]) -> dict:
    rows = []
    for r in results:
        op = next(o for o in OPERATORS if o.op_id == r.op_id)
        rows.append({
            "op_id": r.op_id, "description": op.description, "target": op.target,
            "expected": r.expected_layers, "captured": r.captured_layers,
            "blind": not r.captured_layers,
            "as_expected": set(r.expected_layers) <= set(r.captured_layers),
            "judge_available": r.judge_available,
            "new_findings": r.new_findings[:8]})
    per_layer = {
        ly: {"expected": sum(1 for r in rows if ly in r["expected"]),
             "captured": sum(1 for r in rows if ly in r["captured"])}
        for ly in LAYERS}
    return {"rows": rows, "layers": LAYERS, "per_layer": per_layer}
