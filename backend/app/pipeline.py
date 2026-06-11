"""装配真实校验管线的 registry（随里程碑逐步注册 V3/V4/V5）。"""
from __future__ import annotations

from .orchestrator import Registry, ValidatorSpec
from .validators.instance import validate_shacl_minimal, validate_shacl_trusted
from .validators.schema_layer import validate_consistency, validate_cqs, validate_pitfalls
from .validators.rules import validate_rules
from .validators.structural import validate_structure


def build_registry() -> Registry:
    reg = Registry()
    # V0 结构（veto）
    reg.register(ValidatorSpec(
        "v0.structure", "V0", "veto", validate_structure,
        applicable=lambda b: b.rules is not None or bool(b.processes)))
    # V2 实例层（SHACL 双轨）
    reg.register(ValidatorSpec(
        "v2.shacl_minimal", "V2", "veto", validate_shacl_minimal,
        applicable=lambda b: b.shapes_minimal is not None))
    reg.register(ValidatorSpec(
        "v2.shacl_trusted", "V2", "score", validate_shacl_trusted,
        depends_on=["v2.shacl_minimal"],
        applicable=lambda b: b.shapes_trusted is not None))
    # V1 Schema 层
    reg.register(ValidatorSpec("v1.consistency", "V1", "score", validate_consistency))
    reg.register(ValidatorSpec("v1.pitfalls", "V1", "score", validate_pitfalls))
    reg.register(ValidatorSpec(
        "v1.cq", "V1", "score", validate_cqs,
        depends_on=["v2.shacl_minimal"],
        applicable=lambda b: b.cqs is not None))
    # V3 规则层
    reg.register(ValidatorSpec(
        "v3.rules", "V3", "score", validate_rules,
        depends_on=["v0.structure"],
        applicable=lambda b: b.rules is not None))
    return reg
