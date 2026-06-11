"""D2：本体引擎验收（specs AC-O1..O9、AC-CQ-*）。

测试约定：findings 按 (validator_id, object_id 后缀, finding_type) 断言，
确保「每个预埋缺陷被预期的层捕获，预期漏报真的漏报」。
"""
import pytest

from app import store
from app.datasets import load_bundle
from app.pipeline import build_registry
from app.orchestrator import run_pipeline

EX = "http://example.org/loan#"


@pytest.fixture(scope="module")
def loan_ctx():
    bundle = load_bundle("loan")
    conn = store.connect(":memory:")
    return run_pipeline(bundle, build_registry(), conn, config={"no_cache": True})


def _findings(ctx, validator_id):
    return ctx.results[validator_id].findings


def _has(findings, object_suffix, finding_type=None):
    return any(f.object_id.endswith(object_suffix)
               and (finding_type is None or f.finding_type == finding_type)
               for f in findings)


# ---------- AC-O1：veto → quarantine ----------

def test_o1_missing_applicant_quarantined(loan_ctx):
    assert f"{EX}app001" in loan_ctx.quarantined
    minimal = _findings(loan_ctx, "v2.shacl_minimal")
    assert _has(minimal, "app001", "shacl_min_count")


def test_o1_quarantined_object_filtered_from_trusted(loan_ctx):
    trusted = _findings(loan_ctx, "v2.shacl_trusted")
    assert not _has(trusted, "app001")


# ---------- AC-O2..O7：trusted shape / 推理 ----------

def test_o2_datatype_violation(loan_ctx):
    assert _has(_findings(loan_ctx, "v2.shacl_trusted"), "p002", "shacl_datatype")


def test_o3_enum_violation(loan_ctx):
    assert _has(_findings(loan_ctx, "v2.shacl_trusted"), "app003", "shacl_enum")


def test_o4_range_violations(loan_ctx):
    trusted = _findings(loan_ctx, "v2.shacl_trusted")
    assert _has(trusted, "p004", "shacl_min_inclusive")      # age=-5
    assert _has(trusted, "app004", "shacl_min_exclusive")    # loanAmount=0


def test_o5_relation_range_violation(loan_ctx):
    assert _has(_findings(loan_ctx, "v2.shacl_trusted"), "app005", "shacl_class_range")


def test_o6_disjoint_violation_by_reasoner(loan_ctx):
    cons = _findings(loan_ctx, "v1.consistency")
    assert _has(cons, "p007", "disjoint_violation")


def test_o7_functional_violation(loan_ctx):
    assert _has(_findings(loan_ctx, "v2.shacl_trusted"), "p008", "shacl_max_count")


# ---------- AC-O8：pitfalls ----------

def test_o8_pitfalls(loan_ctx):
    pits = _findings(loan_ctx, "v1.pitfalls")
    assert _has(pits, "Cls_0042", "missing_label")
    assert _has(pits, "miscFlag", "missing_domain_range")
    assert any(f.finding_type == "subclass_cycle"
               and "RetailCustomer" in f.message for f in pits)


# ---------- AC-O9：语义缺陷必须不被确定性层捕获（留给 J1） ----------

def test_o9_semantic_defect_missed_by_deterministic_layers(loan_ctx):
    for vid in ("v2.shacl_minimal", "v2.shacl_trusted", "v1.consistency"):
        assert not any("TemporaryEmployee" in f.object_id or "TemporaryEmployee" in f.message
                       for f in _findings(loan_ctx, vid)), \
            f"{vid} 不应捕获 O9（语义缺陷应留给 J1 演示互补性）"


# ---------- AC-CQ ----------

def test_cq_results(loan_ctx):
    cq = _findings(loan_ctx, "v1.cq")
    failed_ids = {f.object_id for f in cq}
    assert failed_ids == {"cq_002", "cq_003"}                 # 数据缺口 + 本体缺口
    assert loan_ctx.results["v1.cq"].metrics["cq_passed"] == 4


# ---------- pizza：公开本体开箱 ----------

def test_pizza_seeded_inconsistency_caught():
    bundle = load_bundle("pizza")
    conn = store.connect(":memory:")
    ctx = run_pipeline(bundle, build_registry(), conn, config={"no_cache": True})
    cons = ctx.results["v1.consistency"].findings
    assert any(f.object_id.endswith("weirdBase") for f in cons)
    assert ctx.results["v1.cq"].verdict == "pass"
