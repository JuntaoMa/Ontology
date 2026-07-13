"""装配真实校验管线的 registry（随里程碑逐步注册 V3/V4/V5）。"""
from __future__ import annotations

from .judges.j1_semantic import judge_semantic
from .judges.j2_faithfulness import judge_faithfulness
from .judges.j3_review import judge_review
from .orchestrator import Registry, ValidatorSpec
from .validators.instance import validate_shacl_minimal, validate_shacl_trusted
from .validators.schema_layer import validate_consistency, validate_cqs, validate_pitfalls
from .validators.process import (validate_cross, validate_process_formal,
                                 validate_process_simulation)
from .validators.rules import validate_rules
from .validators.structural import validate_structure


def build_registry() -> Registry:
    """校验器=DAG 节点，按目的命名(category.purpose)、按作用对象(scope)归类（spec 20）。"""
    reg = Registry()
    # 句法入口（veto）：结构完整性
    reg.register(ValidatorSpec(
        "intake.structure", "intake", frozenset({"rule", "process"}), "结构完整性",
        "veto", validate_structure,
        applicable=lambda b: b.rules is not None or bool(b.processes)))
    # 实例（SHACL 双轨）
    reg.register(ValidatorSpec(
        "instance.required-fields", "instance", frozenset({"instance"}), "必填底线",
        "veto", validate_shacl_minimal,
        applicable=lambda b: b.shapes_minimal is not None))
    reg.register(ValidatorSpec(
        "instance.data-quality", "instance", frozenset({"instance"}), "数据质量",
        "score", validate_shacl_trusted,
        depends_on=["instance.required-fields"],
        applicable=lambda b: b.shapes_trusted is not None))
    # 本体 schema
    reg.register(ValidatorSpec(
        "schema.consistency", "schema", frozenset({"schema"}), "逻辑一致性",
        "score", validate_consistency))
    reg.register(ValidatorSpec(
        "schema.pitfalls", "schema", frozenset({"schema"}), "建模坏味道",
        "score", validate_pitfalls))
    # 能力问题：查询同时触及 schema 与 instance（多 scope → 本体+实例两组重复展示）
    reg.register(ValidatorSpec(
        "instance.competency", "instance", frozenset({"schema", "instance"}), "能力问题",
        "score", validate_cqs,
        depends_on=["instance.required-fields"],
        applicable=lambda b: b.cqs is not None))
    # 规则
    reg.register(ValidatorSpec(
        "rule.defects", "rule", frozenset({"rule"}), "规则集缺陷",
        "score", validate_rules,
        depends_on=["intake.structure"],
        applicable=lambda b: b.rules is not None))
    # 流程
    reg.register(ValidatorSpec(
        "process.soundness", "process", frozenset({"process"}), "流程健全性",
        "score", validate_process_formal,
        depends_on=["intake.structure"],
        applicable=lambda b: bool(b.processes)))
    # 数据感知仿真：跑真实 case 数据需读规则 guard（多 scope → 规则+流程）
    reg.register(ValidatorSpec(
        "process.simulation", "process", frozenset({"process", "rule"}), "数据感知仿真",
        "score", validate_process_simulation,
        depends_on=["process.soundness"],
        applicable=lambda b: bool(b.processes) and b.rules is not None))
    # 跨域：规则×流程一致（cross 仅作 id 命名空间，展示落在规则+流程两组）
    reg.register(ValidatorSpec(
        "cross.rule-process", "cross", frozenset({"rule", "process"}), "规则×流程一致",
        "score", validate_cross,
        depends_on=["rule.defects", "process.simulation"],
        applicable=lambda b: bool(b.processes) and b.rules is not None))
    # LLM Judge（advise；config["judge"]["enabled"]=True 才真正执行；自带 judge_cache，不走编排缓存）
    reg.register(ValidatorSpec(
        "schema.semantic", "schema", frozenset({"schema"}), "语义合理性",
        "advise", judge_semantic, cacheable=False))
    reg.register(ValidatorSpec(
        "cross.faithfulness", "cross", frozenset({"rule", "process"}), "抽取忠实性",
        "advise", judge_faithfulness,
        depends_on=["intake.structure"],
        applicable=lambda b: b.rules is not None or bool(b.processes),
        cacheable=False))
    reg.register(ValidatorSpec(
        "meta.review", "meta", frozenset(), "复判收口",
        "advise", judge_review,
        depends_on=["instance.data-quality", "schema.consistency", "schema.pitfalls",
                    "instance.competency", "rule.defects", "cross.rule-process",
                    "schema.semantic", "cross.faithfulness"],
        cacheable=False))
    return reg
