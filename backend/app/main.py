"""FastAPI 服务：校验管线 + judge + 注入实验室 + 写入闸门（plan §6）。"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from rdflib.namespace import RDF, RDFS

from . import store
from .datasets import DATASETS_DIR, list_datasets, load_bundle
from .judges.base import load_cassette
from .models import ProcessIR
from .orchestrator import run_pipeline
from .pipeline import build_registry
from .validators.mutation import OPERATORS, matrix_json, run_mutation_lab

DB_PATH = Path(__file__).resolve().parents[1] / "demo.db"
CASSETTE_DIR = Path(__file__).resolve().parents[2] / "cassettes"
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

app = FastAPI(title="知识校验系统 Demo")
conn = store.connect(DB_PATH)
registry = build_registry()
judge_config: dict = {"enabled": True, "tau": 0.85, "model": "claude-opus-4-8"}

for cassette in CASSETTE_DIR.glob("*.json") if CASSETTE_DIR.exists() else []:
    load_cassette(conn, cassette)


def _cfg() -> dict:
    return {"judge": dict(judge_config)}


@app.get("/api/datasets")
def datasets():
    return {"datasets": list_datasets(), "operators": [
        {"op_id": o.op_id, "description": o.description, "target": o.target,
         "expected": o.expected_layers, "needs_judge": o.needs_judge}
        for o in OPERATORS]}


@app.post("/api/runs")
def trigger_run(dataset: str = "loan"):
    bundle = load_bundle(dataset)
    ctx = run_pipeline(bundle, registry, conn, config=_cfg())
    return run_summary(ctx.run_id)


@app.get("/api/runs/{run_id}")
def run_summary(run_id: str):
    runs = conn.execute(
        "SELECT * FROM validation_runs WHERE run_id=? ORDER BY id", (run_id,)).fetchall()
    if not runs:
        raise HTTPException(404, "run 不存在")
    findings = conn.execute(
        "SELECT severity, COUNT(*) n FROM findings WHERE run_id=? AND status='open' "
        "GROUP BY severity", (run_id,)).fetchall()
    quarantined = conn.execute(
        "SELECT object_id, reason FROM quarantine WHERE run_id=? AND restored=0",
        (run_id,)).fetchall()
    cost = conn.execute(
        "SELECT COUNT(*) n, SUM(judge_verdict IS NOT NULL) reviewed, "
        "SUM(judge_verdict IN ('confirm','likely_false_positive') "
        "    AND judge_confidence >= ?) folded "
        "FROM findings WHERE run_id=? AND status='open'",
        (judge_config["tau"], run_id)).fetchone()
    n, folded = cost["n"] or 0, cost["folded"] or 0
    return {
        "run_id": run_id, "dataset": runs[0]["dataset"],
        "validators": [{"validator_id": r["validator_id"], "authority": r["authority"],
                        "verdict": r["verdict"], "cached": bool(r["cached"]),
                        "duration_ms": r["duration_ms"]} for r in runs],
        "findings_by_severity": {r["severity"]: r["n"] for r in findings},
        "quarantine": [dict(q) for q in quarantined],
        "cost_card": {"n_before": n, "reviewed": cost["reviewed"] or 0,
                      "folded": folded, "n_after": n - folded,
                      "saving_pct": round(100 * folded / n, 1) if n else 0.0},
        "judge_stats": _judge_stats()}


def _judge_stats():
    row = conn.execute(
        "SELECT COUNT(*) calls, COALESCE(SUM(tokens_in),0) tin, "
        "COALESCE(SUM(tokens_out),0) tout FROM judge_cache").fetchone()
    return {"cached_responses": row["calls"], "tokens_in": row["tin"],
            "tokens_out": row["tout"]}


@app.get("/api/runs/{run_id}/findings")
def run_findings(run_id: str, validator: str | None = None):
    sql = "SELECT * FROM findings WHERE run_id=?"
    args: list = [run_id]
    if validator:
        sql += " AND validator_id=?"
        args.append(validator)
    rows = [dict(r) for r in conn.execute(sql + " ORDER BY validator_id, id", args)]
    for r in rows:
        r["locus"] = json.loads(r.pop("locus_json") or "{}")
        r["evidence"] = json.loads(r.pop("evidence_json") or "null")
        r["repair"] = json.loads(r.pop("repair_json") or "null")
    return {"findings": rows}


@app.get("/api/ontology/{dataset}/graph")
def ontology_graph(dataset: str):
    bundle = load_bundle(dataset)
    g = bundle.data
    nodes, edges, seen = [], [], set()

    def add_node(uri, kind):
        if uri in seen:
            return
        seen.add(uri)
        label = g.value(uri, RDFS.label)
        nodes.append({"data": {"id": str(uri), "label": str(label) if label
                               else str(uri).split("#")[-1], "kind": kind}})

    from rdflib.namespace import OWL
    for cls in set(g.subjects(RDF.type, OWL.Class)):
        if isinstance(cls, str) or "#" in str(cls):
            add_node(cls, "class")
    for sub, sup in g.subject_objects(RDFS.subClassOf):
        if str(sub) in seen and str(sup) in seen:
            edges.append({"data": {"source": str(sub), "target": str(sup),
                                   "label": "subClassOf"}})
    # 实例（仅 loan 规模可全显）
    for s, _, o in g.triples((None, RDF.type, None)):
        if str(o) in seen and "#" in str(s):
            add_node(s, "individual")
            edges.append({"data": {"source": str(s), "target": str(o), "label": "a"}})
    return {"nodes": nodes, "edges": edges}


@app.get("/api/rules/{dataset}")
def rules(dataset: str):
    bundle = load_bundle(dataset)
    return {"rules": (bundle.rules or {}).get("rules", []),
            "incompatible_actions": (bundle.rules or {}).get("incompatible_actions", [])}


@app.get("/api/process/{dataset}/{process_id}")
def process_ir(dataset: str, process_id: str):
    bundle = load_bundle(dataset)
    if process_id not in bundle.processes:
        raise HTTPException(404, "流程不存在")
    ir = ProcessIR.model_validate(bundle.processes[process_id])
    nodes = ([{"data": {"id": s.id, "label": s.name, "kind": "step"}} for s in ir.steps]
             + [{"data": {"id": gw.id, "label": f"{gw.type}", "kind": f"gateway_{gw.type}"}}
                for gw in ir.gateways])
    edges = [{"data": {"source": e.from_, "target": e.to,
                       "label": e.condition or ""}} for e in ir.edges]
    return {"ir": bundle.processes[process_id], "graph": {"nodes": nodes, "edges": edges}}


@app.post("/api/mutations/run")
def mutations(ops: list[str] | None = None, dataset: str = "loan"):
    bundle = load_bundle(dataset)
    results = run_mutation_lab(bundle, registry, conn, ops=ops,
                               judge_config=dict(judge_config))
    return matrix_json(results)


@app.post("/api/findings/{finding_id}/action")
def finding_action(finding_id: int, action: str, note: str = ""):
    if action not in ("accept", "dismiss", "accept_repair"):
        raise HTTPException(400, "action ∈ accept|dismiss|accept_repair")
    row = conn.execute("SELECT * FROM findings WHERE id=?", (finding_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "finding 不存在")
    status = "accepted" if action in ("accept", "accept_repair") else "dismissed"
    conn.execute("UPDATE findings SET status=? WHERE id=?", (status, finding_id))
    conn.execute(
        "INSERT INTO review_actions(finding_id,action,note,repair_snapshot,created_at) "
        "VALUES(?,?,?,?,?)",
        (finding_id, action, note,
         row["repair_json"] if action == "accept_repair" else None, store.now_iso()))
    conn.commit()
    return {"ok": True, "finding_id": finding_id, "status": status}


@app.post("/api/quarantine/{qid}/restore")
def restore_quarantined(qid: int):
    conn.execute("UPDATE quarantine SET restored=1 WHERE id=?", (qid,))
    conn.commit()
    return {"ok": True}


@app.get("/api/judge/config")
def get_judge_config():
    from .judges.backends import select_backend
    backend = select_backend({"judge": judge_config})
    return {**judge_config, "active_backend": backend.name if backend else "cassette"}


@app.put("/api/judge/config")
def put_judge_config(model: str | None = None, tau: float | None = None,
                     enabled: bool | None = None, backend: str | None = None):
    if model:
        judge_config["model"] = model
    if tau is not None:
        judge_config["tau"] = tau
    if enabled is not None:
        judge_config["enabled"] = enabled
    if backend is not None:
        judge_config["backend"] = backend
    return get_judge_config()


@app.get("/api/export/{dataset}/trusted.ttl", response_class=PlainTextResponse)
def export_trusted(dataset: str, run_id: str):
    """可信导出（AC-GATE-EXPORT）：非 quarantine ∧ 无 open violation 的实例。"""
    bundle = load_bundle(dataset)
    bad = {r["object_id"] for r in conn.execute(
        "SELECT object_id FROM quarantine WHERE run_id=? AND restored=0", (run_id,))}
    bad |= {r["object_id"] for r in conn.execute(
        "SELECT object_id FROM findings WHERE run_id=? AND status='open' "
        "AND severity='violation'", (run_id,))}
    from rdflib import Graph, URIRef
    out = Graph()
    for prefix, ns in bundle.data.namespaces():
        out.bind(prefix, ns)
    for s, p, o in bundle.data:
        if isinstance(s, URIRef) and str(s) in bad:
            continue
        out.add((s, p, o))
    return out.serialize(format="turtle")


if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
else:
    @app.get("/", response_class=HTMLResponse)
    def index():
        return "<h3>前端未构建：cd validation_demo/frontend && npm install && npm run build</h3>"
