from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest


def load_retrieve_skill() -> ModuleType:
    script_path = (
        Path(__file__).parents[1]
        / "profiles"
        / "dev"
        / "skills"
        / "ontology-retrieval"
        / "scripts"
        / "retrieve.py"
    )
    spec = importlib.util.spec_from_file_location("ontology_retrieve_skill", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load ontology retrieval Skill wrapper")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def retrieve_skill() -> ModuleType:
    return load_retrieve_skill()


def test_profile_top_k_is_the_cli_default(
    retrieve_skill: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ONTOLOGY_VECTOR_TOP_K", "7")
    monkeypatch.setattr(
        sys,
        "argv",
        ["retrieve.py", "--mode", "vector", "--question", "什么是温度传感器？"],
    )

    arguments = retrieve_skill.parse_args()

    assert arguments.top_k == 7


def test_retrieval_endpoint_uses_the_canonical_runtime_variable(
    retrieve_skill: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ONTOLOGY_RETRIEVAL_ENDPOINT", "http://127.0.0.1:8010/")
    monkeypatch.setenv("OAG_BASE_URL", "http://should-not-be-used.invalid")

    assert retrieve_skill.service_url("graph") == "http://127.0.0.1:8010/v1/retrieval/graph"


def test_artifact_records_the_profile_graph_algorithm(
    retrieve_skill: ModuleType,
) -> None:
    artifact = retrieve_skill.to_artifact(
        "温度传感器与建筑如何相连？",
        {
            "anchors": [{"id": "TemperatureSensor"}],
            "nodes": [{"id": "TemperatureSensor"}, {"id": "Sensor"}],
            "edges": [
                {
                    "source": "TemperatureSensor",
                    "target": "Sensor",
                    "relations": ["subClassOf"],
                }
            ],
        },
        12,
        "minimum_connected_subgraph",
    )

    assert artifact["metadata"]["algorithm"] == "minimum_connected_subgraph"
    assert artifact["metadata"]["anchor_nodes"] == ["TemperatureSensor"]


class FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.body = json.dumps(payload).encode("utf-8")

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, _size: int) -> bytes:
        return self.body


def test_digest_validation_is_disabled_when_no_digest_is_configured(
    retrieve_skill: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ONTOLOGY_EXPECTED_SHA256", raising=False)
    monkeypatch.setattr(
        retrieve_skill,
        "urlopen",
        lambda *_args, **_kwargs: pytest.fail("health endpoint should not be called"),
    )

    retrieve_skill.validate_ontology_digest(1.0)


def test_digest_validation_checks_health_before_retrieval(
    retrieve_skill: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected_digest = "a" * 64
    requests = []
    monkeypatch.setenv("ONTOLOGY_EXPECTED_SHA256", expected_digest)
    monkeypatch.setenv("ONTOLOGY_RETRIEVAL_ENDPOINT", "http://127.0.0.1:8010/")

    def fake_urlopen(request, timeout):
        requests.append((request, timeout))
        return FakeResponse({"status": "ok", "ontology_sha256": expected_digest})

    monkeypatch.setattr(retrieve_skill, "urlopen", fake_urlopen)

    retrieve_skill.validate_ontology_digest(3.0)

    assert len(requests) == 1
    assert requests[0][0].get_method() == "GET"
    assert requests[0][0].full_url == "http://127.0.0.1:8010/health"
    assert requests[0][1] == 3.0


@pytest.mark.parametrize(
    ("health_payload", "message"),
    [
        ({"status": "ok"}, "did not report a valid ontology digest"),
        (
            {"status": "ok", "ontology_sha256": "b" * 64},
            "Ontology digest mismatch; retrieval was refused",
        ),
    ],
)
def test_digest_validation_refuses_missing_or_mismatched_digest_without_leaks(
    retrieve_skill: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    health_payload: dict[str, object],
    message: str,
) -> None:
    endpoint = "https://internal.example.test/private/api"
    expected_digest = "a" * 64
    monkeypatch.setenv("ONTOLOGY_EXPECTED_SHA256", expected_digest)
    monkeypatch.setenv("ONTOLOGY_RETRIEVAL_ENDPOINT", endpoint)
    monkeypatch.setattr(
        retrieve_skill,
        "urlopen",
        lambda *_args, **_kwargs: FakeResponse(health_payload),
    )

    with pytest.raises(RuntimeError) as error:
        retrieve_skill.validate_ontology_digest(1.0)

    error_message = str(error.value)
    assert message in error_message
    assert endpoint not in error_message
    assert expected_digest not in error_message
    reported_digest = str(health_payload.get("ontology_sha256", ""))
    assert not reported_digest or reported_digest not in error_message
