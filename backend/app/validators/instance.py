"""V2 实例层（SHACL 双轨）：minimal=veto，trusted=score。

inference 显式指定为 "none"（TP §2.5.3 要求显式声明）：
demo 实例全部显式 typed，targetClass 无需推理即可命中；
若开 "rdfs"，range 公理反而会把错误引用的对象推成正确类型，
掩盖 sh:class 违例（AC-O5 的反例教训）——推理与校验的边界必须刻意管理。
"""
from __future__ import annotations

from pyshacl import validate as shacl_validate
from rdflib import Graph
from rdflib.namespace import SH

from ..models import Finding, ValidationResult
from ..orchestrator import Context

_COMPONENT_SHORT = {
    "MinCountConstraintComponent": "min_count",
    "MaxCountConstraintComponent": "max_count",
    "DatatypeConstraintComponent": "datatype",
    "InConstraintComponent": "enum",
    "ClassConstraintComponent": "class_range",
    "MinInclusiveConstraintComponent": "min_inclusive",
    "MaxInclusiveConstraintComponent": "max_inclusive",
    "MinExclusiveConstraintComponent": "min_exclusive",
}


def _parse_report(results_graph: Graph, validator_id: str, severity: str) -> list[Finding]:
    findings: list[Finding] = []
    for result in results_graph.subjects(predicate=None, object=SH.ValidationResult):
        focus = results_graph.value(result, SH.focusNode)
        path = results_graph.value(result, SH.resultPath)
        msg = results_graph.value(result, SH.resultMessage)
        comp = results_graph.value(result, SH.sourceConstraintComponent)
        comp_short = _COMPONENT_SHORT.get(str(comp).split("#")[-1],
                                          str(comp).split("#")[-1]) if comp else "shacl"
        findings.append(Finding(
            validator_id=validator_id, severity=severity,
            object_type="instance", object_id=str(focus),
            finding_type=f"shacl_{comp_short}",
            message=str(msg) if msg else "SHACL 违例",
            locus={"focusNode": str(focus), "path": str(path) if path else None,
                   "constraint": str(comp) if comp else None}))
    return findings


def _run_shacl(data: Graph, shapes: Graph) -> Graph:
    _conforms, results_graph, _text = shacl_validate(
        data_graph=data, shacl_graph=shapes,
        inference="none",       # 显式指定：见模块 docstring
        advanced=False, inplace=False)
    return results_graph


def validate_shacl_minimal(ctx: Context) -> ValidationResult:
    """最低入库 shape（veto）：违例 focusNode 进 quarantine。"""
    b = ctx.bundle
    if b.shapes_minimal is None:
        return ValidationResult("pass")
    findings = _parse_report(_run_shacl(b.data, b.shapes_minimal),
                             "instance.required-fields", "violation")
    return ValidationResult(
        verdict="fail" if findings else "pass",
        findings=findings,
        quarantined={f.object_id for f in findings})


def validate_shacl_trusted(ctx: Context) -> ValidationResult:
    """可信层 shape（score）：违例 = 负证据 finding，不删数据。"""
    b = ctx.bundle
    if b.shapes_trusted is None:
        return ValidationResult("pass")
    findings = _parse_report(_run_shacl(b.data, b.shapes_trusted),
                             "instance.data-quality", "violation")
    return ValidationResult(
        verdict="fail" if findings else "pass", findings=findings)
