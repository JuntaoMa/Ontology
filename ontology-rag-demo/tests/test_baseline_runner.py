from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

RUNNER_PATH = Path(__file__).parents[1] / "baselines" / "run.py"
SPEC = importlib.util.spec_from_file_location("baseline_runner", RUNNER_PATH)
assert SPEC is not None
assert SPEC.loader is not None
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


def trace_with_text(text: str) -> str:
    return json.dumps({"type": "text", "part": {"text": text}}, ensure_ascii=False)


def test_extract_result_accepts_plain_json() -> None:
    expected = {"schema_version": "data-query-plan.v1", "baseline": "oag"}

    assert runner.extract_result(trace_with_text(json.dumps(expected))) == expected


def test_extract_result_accepts_explanation_and_fenced_json() -> None:
    expected = {"schema_version": "data-query-plan.v1", "baseline": "oag"}
    response = (
        "I have enough ontology context.\n\n"
        f"```json\n{json.dumps(expected, ensure_ascii=False)}\n```"
    )

    assert runner.extract_result(trace_with_text(response)) == expected


def test_extract_result_rejects_response_without_json_object() -> None:
    with pytest.raises(RuntimeError, match="does not contain a valid JSON object"):
        runner.extract_result(trace_with_text("No structured result is available."))
