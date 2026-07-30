from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

from ontology_rag_demo import api


def test_health_reports_the_ontology_digest_without_its_path(
    tmp_path: Path,
    monkeypatch,
) -> None:
    ontology_path = tmp_path / "private-ontology.ttl"
    ontology_bytes = b"@prefix ex: <https://example.test/> .\nex:a ex:rel ex:b .\n"
    ontology_path.write_bytes(ontology_bytes)
    monkeypatch.setenv("ONTOLOGY_PATH", str(ontology_path))
    monkeypatch.setattr(api.LanceIndexProbe, "ready", lambda _self: False)

    response = api.health()

    assert response["ontology_sha256"] == hashlib.sha256(ontology_bytes).hexdigest()
    assert str(ontology_path) not in json.dumps(response)


def test_health_omits_the_digest_when_the_ontology_is_missing(
    tmp_path: Path,
    monkeypatch,
) -> None:
    ontology_path = tmp_path / "missing.ttl"
    monkeypatch.setenv("ONTOLOGY_PATH", str(ontology_path))
    monkeypatch.setattr(api.LanceIndexProbe, "ready", lambda _self: False)

    response = api.health()

    assert response["ontology_ready"] is False
    assert "ontology_sha256" not in response


def test_oag_endpoint_returns_vector_hits_and_their_connecting_graph(
    monkeypatch,
) -> None:
    graph = SimpleNamespace(
        as_dict=lambda: {
            "anchors": [{"id": "TemperatureSensor", "label": "温度传感器"}],
            "nodes": [{"id": "TemperatureSensor", "label": "温度传感器"}],
            "edges": [],
            "disconnected": False,
        }
    )
    fake_services = SimpleNamespace(
        oag_retrieve=lambda keywords, top_k, graph_algorithm: (
            [{"id": "TemperatureSensor", "distance": 0.01}],
            graph,
        )
    )
    monkeypatch.setattr(api, "get_services", lambda: fake_services)

    response = api.oag_retrieval(
        api.OagRequest(
            question="温度传感器在哪个建筑？",
            keywords=["温度传感器", "建筑"],
            top_k=5,
            graph_algorithm="minimum_connected_subgraph",
        )
    )

    assert response["keywords"] == ["温度传感器", "建筑"]
    assert response["graph_algorithm"] == "minimum_connected_subgraph"
    assert response["hits"][0]["id"] == "TemperatureSensor"
    assert response["graph"]["anchors"][0]["id"] == "TemperatureSensor"
