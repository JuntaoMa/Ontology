"""FastAPI 服务：校验管线 + judge + 注入实验室 + 写入闸门（plan §6）。"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from rdflib import Literal, URIRef
from rdflib.collection import Collection
from rdflib.namespace import OWL, RDF, RDFS, SH

from . import store
from .datasets import DATASETS_DIR, list_datasets, load_bundle
from .judges.base import load_cassette
from .models import ProcessIR
from .orchestrator import run_pipeline
from .pipeline import build_registry
from .validators.mutation import OPERATORS, matrix_json, run_mutation_lab

APP_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.environ.get("ONTOLOGY_VALIDATION_DB", APP_ROOT / "var" / "validation.db"))
CASSETTE_DIR = Path(
    os.environ.get("ONTOLOGY_VALIDATION_CASSETTES", APP_ROOT / "cassettes")
)
FRONTEND_DIST = Path(
    os.environ.get("ONTOLOGY_VALIDATION_FRONTEND_DIST", APP_ROOT / "dist")
)
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

import threading

app = FastAPI(title="本体校验系统")
conn = store.connect(DB_PATH)
db_lock = threading.RLock()        # 单连接跨线程：串行化写入，避免竞态/锁死
registry = build_registry()
# 默认 backend=cassette：服务器只用录制响应，cache miss 即弃权（绝不在请求里起 live CLI
# 而挂起）。需要真实 judge 时 PUT /api/judge/config {"backend":"cli"} 显式开启。
judge_config: dict = {"enabled": True, "tau": 0.85, "model": "claude-opus-4-8",
                      "backend": "cassette"}

for cassette in CASSETTE_DIR.glob("*.json") if CASSETTE_DIR.exists() else []:
    load_cassette(conn, cassette)


def _cfg() -> dict:
    return {"judge": dict(judge_config)}


@app.get("/api/pipeline/dag")
def pipeline_dag():
    """校验器注册表的依赖 DAG（节点=校验器，边=depends_on）。"""
    return {"nodes": [
        {"id": s.validator_id, "category": s.category, "scope": sorted(s.scope),
         "title": s.title, "authority": s.authority, "depends_on": list(s.depends_on)}
        for s in registry.all()]}


# change-set 场景预设（spec 20 §4）：作用对象 → 触发哪些校验器
SCOPE_SCENARIOS = [
    {"id": "full", "label": "全量校验", "change_set": None,
     "desc": "跑全部适用校验器"},
    {"id": "schema", "label": "改本体 schema", "change_set": ["schema"],
     "desc": "新增/改类·属性·公理 → 只跑本体相关 + 复判"},
    {"id": "instance", "label": "改实例数据", "change_set": ["instance"],
     "desc": "新增/改个体 → 只跑实例相关 + 复判（不跑规则/流程）"},
    {"id": "rule", "label": "改规则", "change_set": ["rule"],
     "desc": "改业务规则 → 规则缺陷 + 规则×流程 + 仿真 + 忠实性 + 复判"},
    {"id": "process", "label": "改流程", "change_set": ["process"],
     "desc": "改流程 → 健全性 + 仿真 + 规则×流程 + 忠实性 + 复判"},
]


@app.get("/api/pipeline/scopes")
def pipeline_scopes():
    """可选的 change-set 场景 + 每个校验器的作用对象（前端选择性触发用）。"""
    return {"scenarios": SCOPE_SCENARIOS,
            "validators": {s.validator_id: {"category": s.category,
                                            "scope": sorted(s.scope),
                                            "title": s.title, "authority": s.authority}
                           for s in registry.all()}}


def _shacl_catalog(shapes) -> list[dict]:
    """把 SHACL shapes 图解析成「目标类 × 属性路径 × 约束」的完整清单。"""
    out = []
    comps = [(SH.minCount, "minCount"), (SH.maxCount, "maxCount"), (SH.datatype, "datatype"),
             (SH["class"], "class"), (SH.minInclusive, "minInclusive"), (SH.maxInclusive, "maxInclusive"),
             (SH.minExclusive, "minExclusive"), (SH.maxExclusive, "maxExclusive"),
             (SH.pattern, "pattern"), (SH.nodeKind, "nodeKind")]
    for shape in set(shapes.subjects(SH.targetClass, None)):
        tc = shapes.value(shape, SH.targetClass)
        for prop in shapes.objects(shape, SH.property):
            path = shapes.value(prop, SH.path)
            msg = shapes.value(prop, SH.message)
            cons = []
            for pred, label in comps:
                v = shapes.value(prop, pred)
                if v is not None:
                    cons.append(f"{label} = {_local(v)}")
            inlist = shapes.value(prop, SH["in"])
            if inlist is not None:
                cons.append("in = [" + ", ".join(str(_local(x)) for x in Collection(shapes, inlist)) + "]")
            out.append({"target_class": _local(tc), "path": _local(path),
                        "constraints": cons, "message": str(msg) if msg else ""})
    out.sort(key=lambda c: (c["target_class"], c["path"]))
    return out


@app.get("/api/validators/{dataset}")
def validator_specs(dataset: str):
    """每个校验器的完整检查清单（不只违例项）——SHACL 解析为具体约束，其余给检查类型/公理。"""
    b = load_bundle(dataset)
    specs: dict[str, dict] = {}

    if b.shapes_minimal is not None:
        specs["instance.required-fields"] = {"title": "最低入库 shape", "kind": "shacl",
            "desc": "blocking 门禁：三元组完整性 / 必填 / 类型可解析（违反进 quarantine）",
            "shacl": _shacl_catalog(b.shapes_minimal)}
    if b.shapes_trusted is not None:
        specs["instance.data-quality"] = {"title": "可信层 shape", "kind": "shacl",
            "desc": "advisory：datatype / 枚举 / 数值范围 / 关系 range / 基数（违反=负证据）",
            "shacl": _shacl_catalog(b.shapes_trusted)}

    # V1 推理一致性：把驱动它的本体公理列出来（disjoint 对 + functional 属性）
    cons = []
    for a, c in b.ontology.subject_objects(OWL.disjointWith):
        if isinstance(a, URIRef) and isinstance(c, URIRef):
            cons.append({"label": "disjoint（互斥类不可共有个体）",
                         "detail": f"{_local(a)} ⊥ {_local(c)}"})
    for p in set(b.ontology.subjects(RDF.type, OWL.FunctionalProperty)):
        cons.append({"label": "functional（至多一个值）", "detail": _local(p)})
    cons.append({"label": "owl:Nothing 成员（不可满足）", "detail": "推理后扫描"})
    specs["schema.consistency"] = {"title": "推理一致性", "kind": "checks",
        "desc": "owlrl 物化后扫描矛盾；下列为本体声明的、驱动检查的公理", "checks": cons}

    specs["schema.pitfalls"] = {"title": "pitfall 扫描", "kind": "checks",
        "desc": "OOPS! 清单的本地可跑子集（结构卫生）", "checks": [
            {"label": "缺 label", "detail": "每个 owl:Class 应有 rdfs:label"},
            {"label": "缺 domain/range", "detail": "每个属性应声明 domain 与 range"},
            {"label": "subClassOf 环", "detail": "类层级不得成环"}]}

    if b.cqs:
        specs["instance.competency"] = {"title": "CQ 回归", "kind": "checks",
            "desc": "本体功能性闸门：每条 CQ 是一个 SPARQL 期望", "checks": [
                {"label": cq["cq_id"], "detail": f'{cq["nl_question"]}（期望 {cq["expected"]["mode"]}）'}
                for cq in b.cqs["cqs"]]}

    specs["rule.defects"] = {"title": "规则缺陷检测", "kind": "checks",
        "desc": "Z3 对业务规则集做的缺陷检查（业务规则 R1–R13 见「规则校验」页）", "checks": [
            {"label": "conflict", "detail": "两条 hard 规则在同一输入下结论互斥"},
            {"label": "dead rule", "detail": "guard 在定义域内永假，永不触发"},
            {"label": "subsumption", "detail": "规则被另一条更宽且同结论的规则蕴含（冗余）"},
            {"label": "coverage gap", "detail": "存在无任何 hard 规则覆盖的输入区域"},
            {"label": "competing（heuristic）", "detail": "heuristic 建议互斥=竞争，非错误"}]}

    specs["process.soundness"] = {"title": "流程形式化", "kind": "checks", "desc": "PM4Py 结构检查", "checks": [
        {"label": "soundness", "detail": "无死锁 / 不可达 / 不当终止（check_soundness）"},
        {"label": "结构", "detail": "start/end 合法、无悬空边、无孤立节点"}]}
    specs["process.simulation"] = {"title": "数据感知仿真", "kind": "checks", "desc": "合成 trace 覆盖率", "checks": [
        {"label": "活动覆盖率", "detail": "每个活动至少被一条数据 trace 触达（=100%）"},
        {"label": "控制流对照", "detail": "play-out 可达 vs 数据可达的差异（暴露数据死分支）"}]}
    specs["cross.rule-process"] = {"title": "规则×流程交叉环", "kind": "checks", "desc": "规则派生约束 × 仿真 trace", "checks": [
        {"label": "conditional-occurrence", "detail": "hard 规则派生 Declare 约束（如 amount>50万 ⇒ ManualReview）跑在 trace 上"}]}

    specs["schema.semantic"] = {"title": "J1 语义合理性", "kind": "criteria", "desc": "LLM 判定（advise）", "checks": [
        {"label": "is-a 合理性", "detail": "subClassOf 是否满足『X 是一种 Y』常识"},
        {"label": "属性签名语义", "detail": "domain/range 是否说得通"}]}
    specs["cross.faithfulness"] = {"title": "J2 抽取忠实性", "kind": "criteria", "desc": "形式化 vs evidence 原文", "checks": [
        {"label": "数值/数量级", "detail": "如『五万』vs 50000"},
        {"label": "方向/顺序/边界", "detail": "流程边方向、比较算子、以上/以下"}]}
    specs["meta.review"] = {"title": "J3 复判 + 修复", "kind": "criteria", "desc": "复判 ambiguous 带并起草修复", "checks": [
        {"label": "confirm / likely_false_positive / uncertain", "detail": "对 warning/竞争/CQ/数值枚举类 finding 复判"},
        {"label": "修复建议 + CQ 三分类", "detail": "本体缺口 / 数据缺口 / CQ 过时"}]}

    specs["intake.structure"] = {"title": "结构完整性", "kind": "checks",
        "desc": "句法入口闸门：规则/流程 IR 的结构与引用完整性（违反进 quarantine）", "checks": [
            {"label": "IR schema", "detail": "规则/流程 IR 通过 Pydantic 结构校验"},
            {"label": "引用完整", "detail": "流程边两端必须是已声明节点（无悬空边）"}]}

    # 用 registry 元数据增强每个条目：作用对象(scope) / 类别(category) / 权限(authority)
    for vid, meta in specs.items():
        try:
            rs = registry.get(vid)
        except KeyError:
            continue
        meta["category"] = rs.category
        meta["scope"] = sorted(rs.scope)
        meta["authority"] = rs.authority
    return specs


@app.get("/api/datasets")
def datasets():
    return {"datasets": list_datasets(), "operators": [
        {"op_id": o.op_id, "description": o.description, "target": o.target,
         "expected": o.expected_layers, "needs_judge": o.needs_judge}
        for o in OPERATORS]}


@app.post("/api/runs")
def trigger_run(dataset: str = "loan", scope: str | None = None):
    """scope 缺省=全量；否则按作用对象选择性触发（逗号分隔，如 scope=instance
    或 scope=rule,process）——spec 20 §4。"""
    bundle = load_bundle(dataset)
    change_set = ({s.strip() for s in scope.split(",") if s.strip()}
                  if scope else None)
    with db_lock:
        ctx = run_pipeline(bundle, registry, conn, config=_cfg(),
                           change_set=change_set)
        return run_summary(ctx.run_id)


@app.get("/api/runs/latest")
def latest_run(dataset: str | None = None):
    """最近一次 run 的汇总（前端刷新后恢复结果用）。"""
    if dataset:
        row = conn.execute("SELECT run_id FROM validation_runs WHERE dataset=? "
                           "ORDER BY id DESC LIMIT 1", (dataset,)).fetchone()
    else:
        row = conn.execute("SELECT run_id FROM validation_runs ORDER BY id DESC LIMIT 1").fetchone()
    if row is None:
        return {"run_id": None}
    return run_summary(row["run_id"])


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
        "SELECT id AS qid, object_id, reason FROM quarantine WHERE run_id=? AND restored=0",
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


# ---------------- 原始输入条目（finding 详情用） ----------------

def _local(term) -> str:
    s = str(term)
    return s.split("#")[-1].split("/")[-1] if isinstance(term, URIRef) else s


def _resolve_uri(bundle, name: str) -> URIRef | None:
    """按 localname 在数据图中找一个主语 URI（J1 的 axiom:/prop: 用）。"""
    for s in set(bundle.data.subjects()):
        if isinstance(s, URIRef) and _local(s) == name:
            return s
    return None


def _subject_triples(bundle, subj: URIRef) -> list[dict]:
    out = []
    for p, o in bundle.data.predicate_objects(subj):
        out.append({
            "p": _local(p),
            "o": _local(o),
            "o_is_uri": isinstance(o, URIRef),
            "datatype": _local(o.datatype) if isinstance(o, Literal) and o.datatype else None,
        })
    out.sort(key=lambda t: (t["p"] != "type", t["p"]))   # rdf:type 置顶
    return out


@app.get("/api/source/{dataset}")
def source(dataset: str, object_type: str, object_id: str):
    """返回某 finding 所指对象的原始输入条目：rdf 三元组 / 规则 IR / 流程 IR / CQ。"""
    bundle = load_bundle(dataset)
    rules = (bundle.rules or {}).get("rules", [])

    # 规则（R5 / R2×R4 / ruleset_id）
    rule_ids = re.split(r"[×x]", object_id) if object_type == "rule" else []
    if rule_ids and all(any(r["rule_id"] == rid for r in rules) for rid in rule_ids):
        picked = [r for r in rules if r["rule_id"] in rule_ids]
        return {"kind": "rule", "object_id": object_id, "rules": picked}
    if object_type == "rule":   # 整个规则集（覆盖 gap）
        return {"kind": "rule", "object_id": object_id, "rules": rules,
                "note": "覆盖缺口针对整个规则集；下列为全部规则"}

    # 流程
    if object_type == "process" and object_id in bundle.processes:
        return {"kind": "process", "object_id": object_id, "process": bundle.processes[object_id]}

    # CQ
    if object_type == "cq" and bundle.cqs:
        cq = next((c for c in bundle.cqs["cqs"] if c["cq_id"] == object_id), None)
        if cq:
            return {"kind": "cq", "object_id": object_id, "cq": cq}

    # J1 语义：axiom:A⊑B / prop:name → 解析出实体再走 rdf
    subj: URIRef | None = None
    if object_id.startswith("axiom:"):
        head = re.split(r"[⊑<]", object_id[len("axiom:"):])[0].strip()
        subj = _resolve_uri(bundle, head)
    elif object_id.startswith("prop:"):
        subj = _resolve_uri(bundle, object_id[len("prop:"):])
    elif object_id.startswith("http"):
        subj = URIRef(object_id)
    else:
        subj = _resolve_uri(bundle, object_id)

    if subj is not None:
        triples = _subject_triples(bundle, subj)
        if triples:
            label = bundle.data.value(subj, RDFS.label)
            return {"kind": "rdf", "object_id": str(subj), "local": _local(subj),
                    "label": str(label) if label else None, "triples": triples}

    return {"kind": "unknown", "object_id": object_id,
            "note": "该 finding 针对的是跨对象判定（如 reasoner 全局），无单一原始条目"}


@app.get("/api/ontology/{dataset}/graph")
def ontology_graph(dataset: str):
    """TBox（类 + subClassOf + 对象属性 domain→range）+ ABox（实例 rdf:type）。
    节点/边带 kind，前端据此分色并可切换显示实例。"""
    from rdflib.namespace import OWL
    bundle = load_bundle(dataset)
    g = bundle.data
    nodes, edges = [], {}
    classes: set = set()

    def add_node(uri, kind):
        if str(uri) in {n["data"]["id"] for n in nodes}:
            return
        label = g.value(uri, RDFS.label)
        nodes.append({"data": {"id": str(uri), "kind": kind,
                               "label": str(label) if label else _local(uri)}})

    def add_edge(s, t, label, kind):
        edges[(str(s), str(t), kind, label)] = {"data": {
            "source": str(s), "target": str(t), "label": label, "kind": kind}}

    for cls in set(g.subjects(RDF.type, OWL.Class)):
        if isinstance(cls, URIRef):
            classes.add(cls)
            add_node(cls, "class")

    # 分类层级
    for sub, sup in g.subject_objects(RDFS.subClassOf):
        if sub in classes and sup in classes:
            add_edge(sub, sup, "subClassOf", "subclass")

    # 对象属性：domain → range（关系结构，此前缺失，是孤立节点的根因）
    for prop in set(g.subjects(RDF.type, OWL.ObjectProperty)):
        dom, rng = g.value(prop, RDFS.domain), g.value(prop, RDFS.range)
        if dom in classes and rng in classes:
            add_edge(dom, rng, _local(prop), "property")

    # 实例（ABox），前端默认折叠
    for s, _p, o in g.triples((None, RDF.type, None)):
        if o in classes and isinstance(s, URIRef):
            add_node(s, "individual")
            add_edge(s, o, "a", "type")

    # 稳定排序：类在前、按 id；边按 (kind, source, target)。让前端的固定排布可复现
    nodes.sort(key=lambda n: (n["data"]["kind"] != "class", n["data"]["id"]))
    edge_list = sorted(edges.values(), key=lambda e: (
        e["data"]["kind"], e["data"]["source"], e["data"]["target"], e["data"]["label"]))
    return {"nodes": nodes, "edges": edge_list}


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
    with db_lock:
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
        return "<h3>前端未构建：在 apps/ontology-validation 运行 pnpm build</h3>"
