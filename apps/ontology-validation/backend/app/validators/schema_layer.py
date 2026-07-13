"""V1 Schema 层（score）：owlrl 推理一致性 + pitfall 扫描 + CQ 回归。"""
from __future__ import annotations

import owlrl
from rdflib import Graph, URIRef
from rdflib.namespace import OWL, RDF, RDFS

from ..models import Finding, ValidationResult
from ..orchestrator import Context

_DAML_ERROR = URIRef("http://www.daml.org/2002/03/agents/agent-ont#error")


# ---------------- 推理一致性 ----------------

def validate_consistency(ctx: Context) -> ValidationResult:
    """owlrl OWL-RL 物化后扫描矛盾：disjoint 共同个体（结构化）+ 错误三元组（兜底）。"""
    g = Graph()
    for t in ctx.bundle.data:
        g.add(t)
    owlrl.DeductiveClosure(owlrl.OWLRL_Semantics).expand(g)

    findings: list[Finding] = []
    seen: set[tuple[str, str, str]] = set()

    # 1) 结构化扫描：每对 disjoint 类的共同个体
    for a, b in g.subject_objects(OWL.disjointWith):
        if not (isinstance(a, URIRef) and isinstance(b, URIRef)):
            continue
        common = set(g.subjects(RDF.type, a)) & set(g.subjects(RDF.type, b))
        for ind in common:
            if not isinstance(ind, URIRef):
                continue
            key = tuple(sorted([str(a), str(b)]) + [str(ind)])
            if key in seen:
                continue
            seen.add(key)
            findings.append(Finding(
                validator_id="schema.consistency", severity="violation",
                object_type="instance", object_id=str(ind),
                finding_type="disjoint_violation",
                message=f"个体同时属于互斥类 {a.split('#')[-1]} 与 {b.split('#')[-1]}",
                locus={"individual": str(ind), "class_a": str(a), "class_b": str(b)}))

    # 2) 兜底：owlrl 写入的错误三元组 / owl:Nothing 成员
    for _s, _p, o in g.triples((None, _DAML_ERROR, None)):
        msg = str(o)
        if "Disjoint classes" in msg and findings:
            continue        # 已被结构化扫描覆盖
        findings.append(Finding(
            validator_id="schema.consistency", severity="violation",
            object_type="ontology", object_id="<reasoner>",
            finding_type="reasoner_inconsistency", message=msg, locus={}))
    for ind in g.subjects(RDF.type, OWL.Nothing):
        findings.append(Finding(
            validator_id="schema.consistency", severity="violation",
            object_type="instance", object_id=str(ind),
            finding_type="member_of_nothing",
            message="个体被推入 owl:Nothing（不可满足）", locus={}))

    return ValidationResult(
        verdict="fail" if findings else "pass", findings=findings)


# ---------------- pitfall 扫描 ----------------

def validate_pitfalls(ctx: Context) -> ValidationResult:
    """OOPS! 清单的本地可跑子集：缺 label / 属性缺 domain·range / subclass 环。"""
    g = ctx.bundle.ontology
    findings: list[Finding] = []

    for cls in set(g.subjects(RDF.type, OWL.Class)):
        if not isinstance(cls, URIRef):
            continue
        if g.value(cls, RDFS.label) is None:
            findings.append(Finding(
                validator_id="schema.pitfalls", severity="info",
                object_type="ontology", object_id=str(cls),
                finding_type="missing_label",
                message=f"类 {cls.split('#')[-1]} 缺少 rdfs:label", locus={}))

    for prop_type in (OWL.ObjectProperty, OWL.DatatypeProperty):
        for prop in set(g.subjects(RDF.type, prop_type)):
            if not isinstance(prop, URIRef):
                continue
            missing = [w for w, pred in (("domain", RDFS.domain), ("range", RDFS.range))
                       if g.value(prop, pred) is None]
            if missing:
                findings.append(Finding(
                    validator_id="schema.pitfalls", severity="info",
                    object_type="ontology", object_id=str(prop),
                    finding_type="missing_domain_range",
                    message=f"属性 {prop.split('#')[-1]} 缺少 {'/'.join(missing)}",
                    locus={"missing": missing}))

    # subclass 环（仅显式声明的 subClassOf 边，忽略推理）
    edges: dict[str, set[str]] = {}
    for s, o in g.subject_objects(RDFS.subClassOf):
        if isinstance(s, URIRef) and isinstance(o, URIRef) and s != o:
            edges.setdefault(str(s), set()).add(str(o))

    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {}
    cycles: list[list[str]] = []

    def dfs(node: str, path: list[str]) -> None:
        color[node] = GRAY
        for nxt in edges.get(node, ()):
            c = color.get(nxt, WHITE)
            if c == GRAY:
                cycles.append(path[path.index(nxt):] + [nxt] if nxt in path else [node, nxt])
            elif c == WHITE:
                dfs(nxt, path + [nxt])
        color[node] = BLACK

    for n in list(edges):
        if color.get(n, WHITE) == WHITE:
            dfs(n, [n])
    seen_cycles: set[frozenset] = set()
    for cyc in cycles:
        nodes = cyc[:-1] if len(cyc) > 1 and cyc[-1] == cyc[0] else cyc
        key = frozenset(nodes)
        if key in seen_cycles:
            continue
        seen_cycles.add(key)
        # 规范化：从字典序最小节点起始（rdflib 图遍历顺序跨实例不稳定，
        # 不规范化会导致环报告漂移、污染变异矩阵的 diff）
        i = nodes.index(min(nodes))
        rotated = nodes[i:] + nodes[:i] + [min(nodes)]
        findings.append(Finding(
            validator_id="schema.pitfalls", severity="warning",
            object_type="ontology", object_id=rotated[0],
            finding_type="subclass_cycle",
            message="subClassOf 存在环：" + " → ".join(c.split('#')[-1] for c in rotated),
            locus={"cycle": rotated}))

    return ValidationResult(
        verdict="fail" if any(f.severity != "info" for f in findings) else "pass",
        findings=findings)


# ---------------- CQ 回归 ----------------

def validate_cqs(ctx: Context) -> ValidationResult:
    b = ctx.bundle
    if not b.cqs:
        return ValidationResult("pass")
    prefix_header = "".join(
        f"PREFIX {k}: <{v}>\n" for k, v in b.cqs.get("prefixes", {}).items())

    findings: list[Finding] = []
    passed = 0
    for cq in b.cqs["cqs"]:
        try:
            rows = list(b.data.query(prefix_header + cq["query"]))
        except Exception as e:                                    # 查询本身坏 → 也算失败
            rows, err = [], str(e)
        else:
            err = None
        values = {str(v) for row in rows for v in row if v is not None}
        mode = cq["expected"]["mode"]
        answers = set(cq["expected"].get("answers", []))
        ok = {"non_empty": len(rows) > 0,
              "empty": len(rows) == 0,
              "exact_set": values == answers,
              "contains": answers <= values}[mode]
        if ok and not err:
            passed += 1
            continue
        findings.append(Finding(
            validator_id="instance.competency", severity="warning",
            object_type="cq", object_id=cq["cq_id"],
            finding_type="cq_failed",
            message=f"CQ 未通过：{cq['nl_question']}（期望 {mode}，得到 {len(rows)} 行）"
                    + (f"；查询错误：{err}" if err else ""),
            locus={"query": cq["query"], "mode": mode,
                   "got": sorted(values)[:10], "expected": sorted(answers)},
            evidence={"nl_question": cq["nl_question"]}))

    return ValidationResult(
        verdict="pass" if not findings else "fail",
        findings=findings,
        metrics={"cq_total": len(b.cqs["cqs"]), "cq_passed": passed})
