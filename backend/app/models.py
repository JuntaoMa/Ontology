"""核心数据模型：finding、校验结果、规则/流程 IR（Pydantic）。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field

Severity = Literal["violation", "warning", "info"]
Authority = Literal["veto", "score", "advise"]


@dataclass
class Finding:
    validator_id: str
    severity: Severity
    object_type: str          # instance | ontology | rule | process | cq
    object_id: str
    finding_type: str
    message: str
    locus: dict[str, Any] = field(default_factory=dict)
    evidence: dict[str, Any] | None = None


@dataclass
class ValidationResult:
    verdict: str                                  # pass | fail | ambiguous
    findings: list[Finding] = field(default_factory=list)
    quarantined: set[str] = field(default_factory=set)   # 仅 veto 校验器使用
    metrics: dict[str, Any] = field(default_factory=dict)


# ---------------- 规则 IR ----------------

class Evidence(BaseModel):
    quote: str = Field(min_length=1)
    source: str = ""


class Conclusion(BaseModel):
    action: str
    polarity: Literal["require", "recommend"]


class RuleIR(BaseModel):
    rule_id: str
    guard: str = Field(min_length=1)
    conclusion: Conclusion
    tier: Literal["hard", "heuristic", "warning", "unknown"]
    evidence: list[Evidence] = Field(min_length=1)


class VariableSpec(BaseModel):
    type: Literal["int", "real", "bool", "enum"]
    min: float | None = None
    max: float | None = None
    min_exclusive: bool = False
    values: list[str] | None = None


class RuleSet(BaseModel):
    ruleset_id: str
    variables: dict[str, VariableSpec]
    incompatible_actions: list[list[str]]
    rules: list[RuleIR]


# ---------------- 流程 IR ----------------

class Step(BaseModel):
    id: str
    name: str
    evidence: list[Evidence] = Field(min_length=1)


class Gateway(BaseModel):
    id: str
    type: Literal["XOR", "AND"]
    evidence: list[Evidence] = Field(min_length=1)


class Edge(BaseModel):
    from_: str = Field(alias="from")
    to: str
    condition: str | None = None
    evidence: list[Evidence] = Field(min_length=1)

    model_config = {"populate_by_name": True}


class ProcessIR(BaseModel):
    process_id: str
    description: str = ""
    start: str
    ends: list[str]
    activity_action_map: dict[str, str] = Field(default_factory=dict)
    steps: list[Step]
    gateways: list[Gateway] = Field(default_factory=list)
    edges: list[Edge]

    def node_kinds(self) -> dict[str, str]:
        kinds = {s.id: "step" for s in self.steps}
        kinds.update({g.id: g.type for g in self.gateways})
        return kinds
