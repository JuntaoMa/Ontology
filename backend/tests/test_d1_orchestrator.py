"""D1：编排器与数据集验收（specs AC-ORCH-1/2/4 + 数据集加载）。"""
import pytest

from app import store
from app.datasets import load_bundle
from app.models import Finding, ValidationResult
from app.orchestrator import Context, Registry, ValidatorSpec, run_pipeline
from app.validators.structural import validate_structure


@pytest.fixture()
def loan():
    return load_bundle("loan")


@pytest.fixture()
def conn():
    return store.connect(":memory:")


# ---------- 数据集加载 ----------

def test_loan_bundle_loads(loan):
    assert len(loan.data) > 300                      # ontology + instances
    assert loan.shapes_minimal is not None and loan.shapes_trusted is not None
    assert len(loan.rules["rules"]) == 13
    assert set(loan.processes) == {"loan_normal", "loan_deadlock", "loan_dead_branch",
                                   "loan_rule_violation", "loan_edge_unfaithful"}
    assert len(loan.cqs["cqs"]) == 6


def test_pizza_bundle_loads():
    pizza = load_bundle("pizza")
    assert len(pizza.ontology) > 1000
    assert pizza.cqs is not None


def test_structural_validator_passes_clean_loan(loan, conn):
    ctx = Context(bundle=loan, conn=conn, run_id="t")
    res = validate_structure(ctx)
    assert res.verdict == "pass", [f.message for f in res.findings]


# ---------- AC-ORCH-1：veto 短路 ----------

def _mk_registry():
    reg = Registry()

    def veto_fn(ctx):
        f = Finding(validator_id="t.veto", severity="violation", object_type="instance",
                    object_id="objA", finding_type="t", message="bad objA")
        return ValidationResult(verdict="fail", findings=[f], quarantined={"objA"})

    def advisory_fn(ctx):
        fs = [Finding(validator_id="t.adv", severity="warning", object_type="instance",
                      object_id=o, finding_type="t", message=f"warn {o}")
              for o in ("objA", "objB")]
        return ValidationResult(verdict="fail", findings=fs)

    reg.register(ValidatorSpec("t.veto", "V0", "veto", veto_fn))
    reg.register(ValidatorSpec("t.adv", "V2", "score", advisory_fn, depends_on=["t.veto"]))
    return reg


def test_veto_short_circuit_quarantines_and_filters(loan, conn):
    ctx = run_pipeline(loan, _mk_registry(), conn, config={"no_cache": True})
    assert "objA" in ctx.quarantined                              # AC-ORCH-1
    adv = ctx.results["t.adv"].findings
    assert [f.object_id for f in adv] == ["objB"]                 # objA 的 finding 被过滤
    qrows = store.quarantined_objects(conn, ctx.run_id)
    assert qrows == {"objA"}


# ---------- AC-ORCH-2：拓扑序 ----------

def test_topo_order_respects_depends_on(loan, conn):
    order: list[str] = []
    reg = Registry()
    reg.register(ValidatorSpec("c", "V2", "score",
                               lambda ctx: (order.append("c"), ValidationResult("pass"))[1],
                               depends_on=["b"]))
    reg.register(ValidatorSpec("a", "V0", "veto",
                               lambda ctx: (order.append("a"), ValidationResult("pass"))[1]))
    reg.register(ValidatorSpec("b", "V1", "score",
                               lambda ctx: (order.append("b"), ValidationResult("pass"))[1],
                               depends_on=["a"]))
    run_pipeline(loan, reg, conn, config={"no_cache": True})
    assert order == ["a", "b", "c"]


# ---------- AC-ORCH-4：缓存 ----------

def test_second_run_hits_cache(loan, conn):
    calls = {"n": 0}
    reg = Registry()

    def fn(ctx):
        calls["n"] += 1
        return ValidationResult("pass", findings=[Finding(
            validator_id="t.c", severity="info", object_type="instance",
            object_id="x", finding_type="t", message="m")])

    reg.register(ValidatorSpec("t.c", "V2", "score", fn))
    run_pipeline(loan, reg, conn)
    ctx2 = run_pipeline(loan, reg, conn)
    assert calls["n"] == 1                                        # 第二次未真实执行
    row = conn.execute("SELECT cached FROM validation_runs WHERE run_id=? AND validator_id='t.c'",
                       (ctx2.run_id,)).fetchone()
    assert row["cached"] == 1
    assert len(ctx2.results["t.c"].findings) == 1                 # 缓存结果仍可消费
