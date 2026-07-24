import json
from pathlib import Path
from typing import Any

import pytest

from tokg.build import DERIVED_STEP_ACTION_RULE, KnowledgeGraphBuilder
from tokg.model import TOKG, concept_iri
from tokg.report import _derived_step_action_ids, generate_report


class ProcedureRecorder:
    def __init__(self) -> None:
        self.concepts: list[tuple[dict[str, Any], str]] = []
        self.relations: list[tuple[dict[str, Any], str]] = []

    def _add_concept(self, concept: dict[str, Any], module: str) -> None:
        self.concepts.append((concept, module))

    def _add_relation(self, relation: dict[str, Any], module: str) -> None:
        self.relations.append((relation, module))


def test_procedure_projects_only_unmodelled_steps_to_derived_actions() -> None:
    recorder = ProcedureRecorder()
    evidence = [{"source": "example", "locator": "1.2"}]
    procedure = {
        "id": "procedure/example",
        "label_en": "Example procedure",
        "label_zh": "示例流程",
        "evidence": evidence,
        "steps": [
            {
                "id": "procedure/example/step-01",
                "label_en": "Update local state",
                "label_zh": "更新本地状态",
                "evidence": evidence,
            },
            {
                "id": "procedure/example/step-02",
                "label_en": "Send request",
                "label_zh": "发送请求",
                "message": "message/request",
                "sender": "role/sender",
                "receiver": "role/receiver",
                "interface": "interface/test",
            },
            {
                "id": "procedure/example/step-03",
                "label_en": "Apply explicit action",
                "label_zh": "执行显式动作",
                "action": "action/explicit",
            },
        ],
    }
    seen: set[str] = set()

    KnowledgeGraphBuilder._add_procedure(recorder, procedure, "test", seen)  # type: ignore[arg-type]

    action_id = "procedure/example/step-01/action"
    projected = [item for item, _ in recorder.concepts if item.get("id") == action_id]
    assert projected == [
        {
            "id": action_id,
            "class": "Action",
            "label_en": "Action: Update local state",
            "label_zh": "动作：更新本地状态",
            "evidence": evidence,
            "status": "proposed",
            "confidence": 1.0,
            "modality": "derived",
            "scope": ["baseline/rel18-open-standards-2026-07"],
            "derived_from": ["procedure/example/step-01"],
            "derivation_rule": DERIVED_STEP_ACTION_RULE,
        }
    ]
    projected_relations = [
        item
        for item, _ in recorder.relations
        if item.get("predicate") == "performsAction"
    ]
    assert any(
        item.get("subject") == "procedure/example/step-01"
        and item.get("object") == action_id
        and item.get("evidence") == evidence
        and item.get("status") == "proposed"
        and item.get("modality") == "derived"
        and item.get("derived_from") == ["procedure/example/step-01"]
        and item.get("derivation_rule") == DERIVED_STEP_ACTION_RULE
        for item in projected_relations
    )
    assert any(
        item.get("subject") == "procedure/example/step-03"
        and item.get("object") == "action/explicit"
        for item in projected_relations
    )
    assert not any(
        item.get("subject") == "procedure/example/step-02"
        for item in projected_relations
    )
    assert action_id in seen


def _assertion_row(step_id: str) -> dict[str, Any]:
    return {
        "subject": str(concept_iri(step_id)),
        "predicate": str(TOKG.performsAction),
        "object_kind": "iri",
        "object": str(concept_iri(f"{step_id}/action")),
        "status": "proposed",
        "modality": "derived",
        "derived_from": [step_id],
        "derivation_rule": DERIVED_STEP_ACTION_RULE,
        "evidence_ids": ["https://example.org/tokg/id/evidence/sha256/example"],
    }


def test_report_index_requires_the_complete_derived_action_contract() -> None:
    step_id = "procedure/example/step-01"
    good = _assertion_row(step_id)
    assert _derived_step_action_ids([good]) == {step_id}

    for field, bad_value in (
        ("predicate", str(TOKG.usesTimer)),
        ("object", str(concept_iri("action/wrong"))),
        ("status", "reviewed"),
        ("modality", "asserted"),
        ("derived_from", []),
        ("derived_from", [step_id, "procedure/example/step-00"]),
        ("derivation_rule", "a different rule"),
        ("evidence_ids", []),
    ):
        bad = {**good, field: bad_value}
        assert _derived_step_action_ids([bad]) == set()


@pytest.mark.parametrize(("with_assertion", "expected_count", "expected_gap"), [(True, 1, False), (False, 0, True)])
def test_coverage_counts_only_materialized_derived_actions(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    with_assertion: bool,
    expected_count: int,
    expected_gap: bool,
) -> None:
    for directory in ("config", "sources", "catalog", "release/jsonl"):
        (tmp_path / directory).mkdir(parents=True, exist_ok=True)
    (tmp_path / "config" / "standards.json").write_text(
        json.dumps({"sources": [], "baseline": {}}), encoding="utf-8"
    )
    (tmp_path / "sources" / "lock.json").write_text(
        json.dumps({"sources": []}), encoding="utf-8"
    )
    step_id = "procedure/example/step-01"
    (tmp_path / "catalog" / "test.json").write_text(
        json.dumps(
            {
                "module": "test",
                "procedures": [
                    {
                        "id": "procedure/example",
                        "steps": [{"id": step_id}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    rows = [_assertion_row(step_id)] if with_assertion else []
    (tmp_path / "release" / "jsonl" / "assertions.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8"
    )
    monkeypatch.setattr(
        "tokg.report.audit_evidence",
        lambda _: {
            "conforms": True,
            "finding_count": 0,
            "unique_finding_count": 0,
            "warning_count": 0,
            "findings": [],
            "warnings": [],
        },
    )

    report = generate_report(tmp_path)

    assert report["catalog"]["derived_step_actions_by_module"].get("test", 0) == expected_count
    has_gap = any(
        gap["kind"] == "step-without-message-or-action" for gap in report["gaps"]
    )
    assert has_gap is expected_gap
