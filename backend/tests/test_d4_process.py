"""D4：流程引擎验收（specs AC-P-*）。"""
import pytest

from app import store
from app.datasets import load_bundle
from app.pipeline import build_registry
from app.orchestrator import run_pipeline


@pytest.fixture(scope="module")
def ctx():
    bundle = load_bundle("loan")
    return run_pipeline(bundle, build_registry(), store.connect(":memory:"),
                        config={"no_cache": True})


def _of(ctx, vid, pid, ftype=None):
    return [f for f in ctx.results[vid].findings
            if f.object_id == pid and (ftype is None or f.finding_type == ftype)]


# AC-P-SOUND：正常流程全部通过
def test_normal_process_clean(ctx):
    assert ctx.results["process.soundness"].metrics["loan_normal"]["sound"] is True
    assert not _of(ctx, "process.soundness", "loan_normal")
    sim = ctx.results["process.simulation"].metrics["loan_normal"]
    assert sim["data_coverage_pct"] == 100.0
    assert not _of(ctx, "cross.rule-process", "loan_normal")


# AC-P-DEADLOCK：XOR-split 配 AND-join 被 soundness 抓
def test_deadlock_caught_by_soundness(ctx):
    assert ctx.results["process.soundness"].metrics["loan_deadlock"]["sound"] is False
    assert _of(ctx, "process.soundness", "loan_deadlock", "process_unsound")


# AC-P-DEADBRANCH：数据感知仿真 0 执行；控制流 play-out 可达（差异演示）
def test_dead_branch_caught_by_data_simulation(ctx):
    assert ctx.results["process.soundness"].metrics["loan_dead_branch"]["sound"] is True  # 结构健全
    sim = ctx.results["process.simulation"].metrics["loan_dead_branch"]
    assert sim["zero_activities_data"] == ["express_channel"]
    assert sim["data_coverage_pct"] < 100.0
    fs = _of(ctx, "process.simulation", "loan_dead_branch", "dead_activity_data")
    assert fs and fs[0].locus["cf_reachable"] is True


# AC-P-CROSS：阈值 80万 vs R10 的 50万 被交叉环抓且回链规则
def test_rule_violation_caught_by_cross_loop(ctx):
    assert ctx.results["process.soundness"].metrics["loan_rule_violation"]["sound"] is True
    fs = _of(ctx, "cross.rule-process", "loan_rule_violation", "cross_validation_violation")
    assert len(fs) == 1
    f = fs[0]
    assert f.locus["source_rule"] == "R10"
    sample = f.locus["sample_case"]
    assert 500000 < sample["data"]["loan_amount"] <= 800000
    assert "manual_review" not in sample["activities"]
    assert "50万" in f.evidence["rule_quote"]


# AC-P-FAITH（负向断言）：边方向忠实性缺陷不被 V4 捕获（留给 J2）
def test_edge_unfaithful_missed_by_v4(ctx):
    assert ctx.results["process.soundness"].metrics["loan_edge_unfaithful"]["sound"] is True
    assert not _of(ctx, "process.soundness", "loan_edge_unfaithful")
    assert not _of(ctx, "process.simulation", "loan_edge_unfaithful")
    assert not _of(ctx, "cross.rule-process", "loan_edge_unfaithful")
