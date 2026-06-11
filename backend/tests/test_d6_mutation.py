"""D6：错误注入与捕获率矩阵验收（specs AC-MUT-*）。"""
import json

import pytest

from app import store
from app.datasets import load_bundle
from app.pipeline import build_registry
from app.validators.mutation import matrix_json, run_mutation_lab

from tests.test_d5_judges import ScriptedBackend, _verdict


def _llm_backend():
    """变异后的 J1/J2 脚本响应：对注入的语义/忠实性缺陷给 issue_found。"""
    def j1(prompt):
        items = []
        if "RiskAssessment⊑Employee" in prompt:
            items.append(_verdict(
                "axiom:RiskAssessment⊑Employee", "issue_found",
                "RiskAssessment（label=风险评估", "评估记录不是员工的一种"))
        return json.dumps({"items": items}, ensure_ascii=False)

    def j2(prompt):
        items = []
        if "loan_amount > 10000」" in prompt:
            items.append(_verdict(
                "rule:R12", "issue_found", "10万元以上的申请建议补充收入流水",
                "原文 10 万，guard 写成 1 万"))
        if "新规要求先完成风险评估" in prompt:
            items.append(_verdict(
                "edge:loan_normal:completeness_check→risk_assessment", "issue_found",
                "新规要求先完成风险评估，评估通过后再核对材料完整性",
                "边方向与原文相反"))
        return json.dumps({"items": items}, ensure_ascii=False)

    return ScriptedBackend(j1=j1, j2=j2, j3=json.dumps({"items": []}))


@pytest.fixture(scope="module")
def lab():
    bundle = load_bundle("loan")
    conn = store.connect(":memory:")
    results = run_mutation_lab(bundle, build_registry(), conn,
                               judge_config={"backend_obj": _llm_backend()})
    return {r.op_id: r for r in results}, matrix_json(results)


# AC-MUT-DET：形式型变异被确定性层捕获
@pytest.mark.parametrize("op,layer", [
    ("mut_remove_required", "V2"), ("mut_enum_invalid", "V2"),
    ("mut_negative_value", "V2"), ("mut_subclass_cycle", "V1"),
    ("mut_flip_operator", "V3"), ("mut_drop_guard_clause", "V3"),
    ("mut_xor_to_and", "V4"), ("mut_drop_edge", "V4"),
    ("mut_gateway_threshold", "V4"),
])
def test_deterministic_mutations_captured(lab, op, layer):
    results, _ = lab
    assert layer in results[op].captured_layers, \
        f"{op} 应被 {layer} 捕获，实际 {results[op].captured_layers}：{results[op].new_findings}"


# AC-MUT-LLM：语义/忠实性变异确定性层全 miss、仅 V5 捕获
@pytest.mark.parametrize("op", [
    "mut_wrong_parent", "mut_guard_vs_evidence", "mut_edge_evidence_reverse"])
def test_llm_only_mutations(lab, op):
    results, _ = lab
    assert results[op].captured_layers == ["V5"], \
        f"{op} 应仅被 V5 捕获，实际 {results[op].captured_layers}：{results[op].new_findings}"


# AC-MUT-BLIND：删 disjointness 全层 miss（矩阵如实呈现盲区）
def test_remove_disjoint_is_blind_spot(lab):
    results, matrix = lab
    assert results["mut_remove_disjoint"].captured_layers == []
    row = next(r for r in matrix["rows"] if r["op_id"] == "mut_remove_disjoint")
    assert row["blind"] is True


def test_matrix_shape(lab):
    _, matrix = lab
    assert len(matrix["rows"]) == 13
    assert matrix["layers"] == ["V0", "V1", "V2", "V3", "V4", "V5"]
    assert all(r["as_expected"] for r in matrix["rows"]), \
        [r for r in matrix["rows"] if not r["as_expected"]]
