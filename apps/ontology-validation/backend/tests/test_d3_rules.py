"""D3：规则引擎验收（specs AC-R-*）。"""
import pytest

from app import store
from app.datasets import load_bundle
from app.pipeline import build_registry
from app.orchestrator import run_pipeline


@pytest.fixture(scope="module")
def rules_findings():
    bundle = load_bundle("loan")
    ctx = run_pipeline(bundle, build_registry(), store.connect(":memory:"),
                       config={"no_cache": True})
    return ctx.results["rule.defects"].findings


def _by_type(findings, t):
    return [f for f in findings if f.finding_type == t]


# AC-R-CONFLICT：R2×R4 是唯一 hard 冲突，且给出具体反例
def test_conflict_r2_r4_with_counterexample(rules_findings):
    conflicts = _by_type(rules_findings, "rule_conflict")
    pairs = {frozenset((f.locus["rule_a"], f.locus["rule_b"])) for f in conflicts}
    assert pairs == {frozenset(("R2", "R4"))}, f"非预期冲突集合：{pairs}"
    ce = conflicts[0].locus["counterexample"]
    assert ce["monthly_income"] >= 5000 and ce["credit_score"] < 600
    assert 18 <= ce["age"] <= 65 and ce["loan_amount"] <= 100000


# AC-R-DEAD：R5 永不触发
def test_dead_rule_r5(rules_findings):
    dead = _by_type(rules_findings, "dead_rule")
    assert [f.object_id for f in dead] == ["R5"]


# AC-R-SUBSUME：R6 被 R1 吞（且只有这一对）
def test_subsumption_r6_by_r1(rules_findings):
    subs = _by_type(rules_findings, "rule_subsumed")
    assert [(f.locus["subsumed"], f.locus["by"]) for f in subs] == [("R6", "R1")]


# AC-R-GAP：存在未覆盖区域并给出具体样例
def test_coverage_gap_with_sample(rules_findings):
    gaps = _by_type(rules_findings, "coverage_gap")
    assert len(gaps) == 1
    sample = gaps[0].locus["uncovered_sample"]
    assert set(sample) == {"age", "monthly_income", "loan_amount", "credit_score"}


# AC-R-COMPETE：R8×R9 是竞争建议（info），不是 conflict
def test_competing_suggestion_r8_r9(rules_findings):
    comp = _by_type(rules_findings, "competing_suggestion")
    pairs = {frozenset((f.locus["rule_a"], f.locus["rule_b"])) for f in comp}
    assert frozenset(("R8", "R9")) in pairs
    assert all(f.severity == "info" for f in comp)


# AC-R-FAITH（负向断言）：R11 忠实性缺陷不被 V3 捕获（留给 J2）
def test_r11_faithfulness_missed_by_z3(rules_findings):
    assert not any("R11" in f.object_id for f in rules_findings), \
        "V3 不应捕获 R11（数量级抽错在逻辑上自洽，应留给 J2 演示互补性）"
