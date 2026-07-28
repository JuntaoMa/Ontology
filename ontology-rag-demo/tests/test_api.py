from __future__ import annotations

import hashlib
import json
from pathlib import Path

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
