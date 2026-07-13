"""V0 语法与结构校验（veto）：规则/流程 IR 的 Pydantic 校验 + evidence 非空。"""
from __future__ import annotations

from pydantic import ValidationError

from ..models import Finding, ProcessIR, RuleIR, RuleSet, ValidationResult
from ..orchestrator import Context


def validate_structure(ctx: Context) -> ValidationResult:
    findings: list[Finding] = []
    quarantined: set[str] = set()
    b = ctx.bundle

    if b.rules is not None:
        try:
            RuleSet.model_validate(b.rules)
        except ValidationError:
            # 整体失败时逐条定位，可定位的坏规则进 quarantine
            for raw in b.rules.get("rules", []):
                rid = raw.get("rule_id", "<missing>")
                try:
                    RuleIR.model_validate(raw)
                except ValidationError as e:
                    quarantined.add(rid)
                    findings.append(Finding(
                        validator_id="intake.structure", severity="violation",
                        object_type="rule", object_id=rid,
                        finding_type="structural_invalid",
                        message=f"规则 IR 结构校验失败：{e.errors()[0]['msg']}",
                        locus={"errors": [str(err['loc']) for err in e.errors()]}))

    for pid, raw in b.processes.items():
        try:
            ir = ProcessIR.model_validate(raw)
            kinds = ir.node_kinds()
            bad_refs = [e for e in ir.edges
                        if e.from_ not in kinds or e.to not in kinds]
            if bad_refs:
                quarantined.add(pid)
                findings.append(Finding(
                    validator_id="intake.structure", severity="violation",
                    object_type="process", object_id=pid,
                    finding_type="dangling_edge",
                    message=f"流程存在悬空边：{[(e.from_, e.to) for e in bad_refs]}",
                    locus={"edges": [(e.from_, e.to) for e in bad_refs]}))
        except ValidationError as e:
            quarantined.add(pid)
            findings.append(Finding(
                validator_id="intake.structure", severity="violation",
                object_type="process", object_id=pid,
                finding_type="structural_invalid",
                message=f"流程 IR 结构校验失败：{e.errors()[0]['msg']}",
                locus={"errors": [str(err['loc']) for err in e.errors()]}))

    return ValidationResult(
        verdict="fail" if findings else "pass",
        findings=findings, quarantined=quarantined)
