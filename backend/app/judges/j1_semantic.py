"""J1 语义合理性 judge（advise）：类/关系的「名称-公理」一致性。

确定性引擎的盲区：公理逻辑自洽但语义荒谬（AC-O9 TemporaryEmployee⊑Document）。
"""
from __future__ import annotations

from rdflib import URIRef
from rdflib.namespace import OWL, RDF, RDFS

from ..models import Finding, ValidationResult
from ..orchestrator import Context
from .base import run_judge

SYSTEM = """你是本体工程的语义评审专家。给你一组本体公理（subClassOf 与属性签名），
每条附有类/属性的标签与注释。逐条判断其**语义合理性**：
- subClassOf 公理应满足「X 是一种 Y」的常识检验（注意区分 is-a 与 part-of/has-a/相关性）；
- 属性签名应满足 domain/range 在语义上说得通。
逻辑一致性不是你的任务（推理机已检查过）；你只判断语义层面是否荒谬或可疑。
verdict 取值：issue_found（语义明显不合理）/ no_issue / uncertain（说不准）。
dimensions 至少包含 {"is_a_plausible": bool}。宁可 uncertain 不要妄断。"""


def _label(g, node) -> str:
    lbl = g.value(node, RDFS.label)
    cmt = g.value(node, RDFS.comment)
    local = str(node).split("#")[-1]
    parts = [local]
    if lbl:
        parts.append(f"label={lbl}")
    if cmt:
        parts.append(f"comment={cmt}")
    return "（".join([parts[0], "，".join(parts[1:])]) + "）" if len(parts) > 1 else local


def judge_semantic(ctx: Context) -> ValidationResult:
    if not (ctx.config.get("judge", {}).get("enabled")):
        return ValidationResult("pass", metrics={"skipped": "judge disabled"})
    g = ctx.bundle.ontology
    items: list[dict] = []
    material: dict[str, str] = {}

    classes = set(g.subjects(RDF.type, OWL.Class))
    for sub, sup in g.subject_objects(RDFS.subClassOf):
        if not (isinstance(sub, URIRef) and isinstance(sup, URIRef)):
            continue
        if sub not in classes or sup not in classes:
            continue
        item_id = f"axiom:{str(sub).split('#')[-1]}⊑{str(sup).split('#')[-1]}"
        text = f"{_label(g, sub)} rdfs:subClassOf {_label(g, sup)}"
        items.append({"item_id": item_id, "axiom": text})
        material[item_id] = text

    for prop_type in (OWL.ObjectProperty, OWL.DatatypeProperty):
        for prop in set(g.subjects(RDF.type, prop_type)):
            if not isinstance(prop, URIRef):
                continue
            dom, rng = g.value(prop, RDFS.domain), g.value(prop, RDFS.range)
            if dom is None or rng is None:
                continue
            item_id = f"prop:{str(prop).split('#')[-1]}"
            text = (f"属性 {_label(g, prop)}：domain={_label(g, dom)} "
                    f"range={str(rng).split('#')[-1]}")
            items.append({"item_id": item_id, "signature": text})
            material[item_id] = text

    if not items:
        return ValidationResult("pass")
    items = items[:80]                          # 批量上限

    import json
    prompt = ("逐条评审以下公理/属性签名的语义合理性：\n"
              + json.dumps(items, ensure_ascii=False, indent=1))
    out, meta = run_judge(judge_id="j1_semantic", system=SYSTEM, prompt=prompt,
                          source_material=material, conn=ctx.conn, config=ctx.config)

    findings: list[Finding] = []
    if out is not None:
        for item in out.items:
            if item.verdict != "issue_found":
                continue
            findings.append(Finding(
                validator_id="v5.j1", severity="warning",
                object_type="ontology", object_id=item.item_id,
                finding_type="semantic_implausible",
                message=f"语义可疑：{item.rationale}",
                locus={"dimensions": item.dimensions, "confidence": item.confidence,
                       "cited": item.cited_evidence},
                evidence={"repair_suggestion": item.repair_suggestion}))
    return ValidationResult(
        verdict="pass" if not findings else "fail",
        findings=findings,
        metrics={"backend": meta.backend, "cached": meta.cached,
                 "tokens_in": meta.tokens_in, "tokens_out": meta.tokens_out,
                 "downgraded": meta.downgraded, "abstained": out is None,
                 "items": len(items)})
