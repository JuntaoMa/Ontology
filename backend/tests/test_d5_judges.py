"""D5：LLM Judge 层验收（specs AC-J-*；用脚本化后端做确定性单测，
真实 judge 行为由 cassette 录制脚本验证）。"""
import json

import pytest

from app import store
from app.datasets import load_bundle
from app.judges import backends as bk
from app.judges.base import dump_cassette, load_cassette
from app.pipeline import build_registry
from app.orchestrator import run_pipeline

O9_ITEM = "axiom:TemporaryEmployee⊑Document"
O9_CITE = "TemporaryEmployee（label=临时雇员"
R11_CITE = "月收入五万元以上的高净值客户方可进入快速通道"
EDGE_ITEM = "edge:loan_edge_unfaithful:completeness_check→risk_assessment"
EDGE_CITE = "先进行风险评估，评估通过后再核对材料完整性"


def _verdict(item_id, verdict, cite, rationale="r", repair=None, conf=0.9, cls=None):
    return {"item_id": item_id, "verdict": verdict, "dimensions": {"d": True},
            "confidence": conf, "cited_evidence": cite, "rationale": rationale,
            "repair_suggestion": repair, "classification": cls}


class ScriptedBackend:
    """按 system prompt 关键词路由到 J1/J2/J3 的脚本响应。"""
    name = "scripted"

    def __init__(self, j1=None, j2=None, j3=None):
        self.handlers = {"语义评审": j1, "质检专家": j2, "复审专家": j3}
        self.calls = []

    def complete(self, system, prompt, model):
        self.calls.append(system[:12])
        for key, h in self.handlers.items():
            if h is not None and key in system:
                text = h(prompt) if callable(h) else h
                return bk.BackendResponse(text=text, tokens_in=100, tokens_out=50)
        return bk.BackendResponse(text=json.dumps({"items": []}))


def _j1_response(prompt):
    return json.dumps({"items": [
        _verdict(O9_ITEM, "issue_found", O9_CITE,
                 "临时雇员是人，不是材料文档；该公理混淆了 is-a 语义",
                 repair="TemporaryEmployee 应 subClassOf Employee")]},
        ensure_ascii=False)


def _j2_response(prompt):
    return json.dumps({"items": [
        _verdict("rule:R11", "issue_found", R11_CITE,
                 "原文是『五万』(50000)，guard 写成 5000，数量级抽错",
                 repair="guard 改为 monthly_income >= 50000"),
        _verdict(EDGE_ITEM, "issue_found", EDGE_CITE,
                 "原文要求先风险评估后完整性检查，IR 边方向相反")]},
        ensure_ascii=False)


def _j3_response(prompt):
    payload, _ = json.JSONDecoder().raw_decode(prompt[prompt.index("["):])
    items = []
    for it in payload:
        cite = it["finding"][:20]
        if it["finding_type"] == "shacl_enum":
            items.append(_verdict(it["item_id"], "confirm", cite,
                                  "枚举越界，疑似 HIGH 笔误", repair="HIGH", conf=0.95))
        elif it["finding_type"] == "cq_failed" and "cq_002" in it["finding"]:
            items.append(_verdict(it["item_id"], "confirm", cite, "确为数据缺失",
                                  conf=0.9, cls="data_gap"))
        elif it["finding_type"] == "cq_failed":
            items.append(_verdict(it["item_id"], "confirm", cite, "本体缺该属性",
                                  conf=0.9, cls="ontology_gap"))
        elif it["finding_type"] == "missing_label":
            items.append(_verdict(it["item_id"], "confirm", cite, "确认缺标签",
                                  repair="补 rdfs:label", conf=0.92))
        else:
            items.append(_verdict(it["item_id"], "uncertain", cite, "需人工", conf=0.4))
    return json.dumps({"items": items}, ensure_ascii=False)


def _run(backend, conn=None):
    conn = conn or store.connect(":memory:")
    cfg = {"no_cache": True, "judge": {"enabled": True, "backend_obj": backend}}
    ctx = run_pipeline(load_bundle("loan"), build_registry(), conn, config=cfg)
    return ctx, conn


@pytest.fixture(scope="module")
def judged():
    backend = ScriptedBackend(j1=_j1_response, j2=_j2_response, j3=_j3_response)
    ctx, conn = _run(backend)
    return ctx, conn


# ---------- AC-MUT-LLM 前置：三个仅 LLM 可抓缺陷被 judge 层产出 ----------

def test_j1_catches_o9(judged):
    ctx, _ = judged
    fs = ctx.results["v5.j1"].findings
    assert any(f.object_id == O9_ITEM and f.finding_type == "semantic_implausible"
               for f in fs)


def test_j2_catches_r11_and_unfaithful_edge(judged):
    ctx, _ = judged
    fs = ctx.results["v5.j2"].findings
    assert any(f.object_id == "R11" for f in fs)
    assert any(f.object_id == "loan_edge_unfaithful" for f in fs)


# ---------- AC-J-ROUTE ----------

def test_j3_routes_only_ambiguous_band(judged):
    ctx, conn = judged
    rows = conn.execute(
        "SELECT finding_type, judge_verdict FROM findings WHERE run_id=?",
        (ctx.run_id,)).fetchall()
    reviewed = {r["finding_type"] for r in rows if r["judge_verdict"] is not None}
    assert "shacl_enum" in reviewed and "cq_failed" in reviewed
    for terminal in ("rule_conflict", "dead_rule", "process_unsound",
                     "disjoint_violation", "cross_validation_violation"):
        assert all(r["judge_verdict"] is None for r in rows
                   if r["finding_type"] == terminal), f"{terminal} 不应被复判"


def test_j3_repair_and_classification(judged):
    ctx, conn = judged
    enum_row = conn.execute(
        "SELECT repair_json FROM findings WHERE run_id=? AND finding_type='shacl_enum'",
        (ctx.run_id,)).fetchone()
    assert json.loads(enum_row["repair_json"])["suggestion"] == "HIGH"
    cq_rows = conn.execute(
        "SELECT object_id, repair_json FROM findings WHERE run_id=? AND finding_type='cq_failed'",
        (ctx.run_id,)).fetchall()
    cls = {r["object_id"]: json.loads(r["repair_json"])["classification"] for r in cq_rows}
    assert cls == {"cq_002": "data_gap", "cq_003": "ontology_gap"}


# ---------- AC-J-COST ----------

def test_cost_card_metrics(judged):
    ctx, _ = judged
    m = ctx.results["v5.j3"].metrics
    assert m["n_before"] > m["n_after"] and m["folded"] >= 3
    assert 0 < m["saving_pct"] < 100


# ---------- AC-J-EVIDENCE：引用不在源材料 → 程序降级 ----------

def test_evidence_enforcement_downgrades():
    fake_cite = json.dumps({"items": [
        _verdict(O9_ITEM, "issue_found", "这段话不在任何源材料里", "凭空断言")]},
        ensure_ascii=False)
    backend = ScriptedBackend(j1=fake_cite, j2=json.dumps({"items": []}),
                              j3=json.dumps({"items": []}))
    ctx, _ = _run(backend)
    assert ctx.results["v5.j1"].metrics["downgraded"] == 1
    assert not ctx.results["v5.j1"].findings          # 降级后不产出 finding


# ---------- AC-J-SCHEMA：解析失败重试一次，再失败弃权 ----------

def test_parse_retry_then_succeed():
    state = {"n": 0}

    def flaky_j1(prompt):
        state["n"] += 1
        return "垃圾输出 not json" if state["n"] == 1 else _j1_response(prompt)

    backend = ScriptedBackend(j1=flaky_j1, j2=json.dumps({"items": []}),
                              j3=json.dumps({"items": []}))
    ctx, _ = _run(backend)
    assert state["n"] == 2
    assert any(f.object_id == O9_ITEM for f in ctx.results["v5.j1"].findings)


def test_parse_fail_twice_abstains():
    backend = ScriptedBackend(j1="不是json", j2=json.dumps({"items": []}),
                              j3=json.dumps({"items": []}))
    ctx, _ = _run(backend)
    assert ctx.results["v5.j1"].metrics["abstained"] is True
    assert not ctx.results["v5.j1"].findings


# ---------- AC-J-BACKEND：选择顺序 ----------

def test_backend_selection(monkeypatch):
    assert bk.select_backend({"judge": {"backend": "cassette"}}) is None
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    assert isinstance(bk.select_backend({}), bk.ApiBackend)
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/claude")
    assert isinstance(bk.select_backend({}), bk.CliBackend)
    monkeypatch.setattr("shutil.which", lambda _: None)
    assert bk.select_backend({}) is None


# ---------- AC-J-CASSETTE：录制 → 回放，无后端全流程可跑 ----------

def test_cassette_replay_without_backend(judged, tmp_path):
    _, conn1 = judged
    cassette = tmp_path / "loan_cassette.json"
    assert dump_cassette(conn1, cassette) >= 3        # j1/j2/j3 至少各一条

    conn2 = store.connect(":memory:")
    load_cassette(conn2, cassette)
    cfg = {"no_cache": True, "judge": {"enabled": True, "backend": "cassette"}}
    ctx2 = run_pipeline(load_bundle("loan"), build_registry(), conn2, config=cfg)

    assert ctx2.results["v5.j1"].metrics["cached"] is True
    assert any(f.object_id == O9_ITEM for f in ctx2.results["v5.j1"].findings)
    assert any(f.object_id == "R11" for f in ctx2.results["v5.j2"].findings)
    assert ctx2.results["v5.j3"].metrics["folded"] >= 3
