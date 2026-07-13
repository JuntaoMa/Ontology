"""运行时校验器与目标设计注册表之间的工程追踪契约。"""
from __future__ import annotations

import json
from pathlib import Path

from app.pipeline import build_registry


APP_ROOT = Path(__file__).resolve().parents[2]
MAP_PATH = APP_ROOT / "specs" / "runtime-design-map.json"
DESIGN_REGISTRY_PATH = APP_ROOT / "docs" / "system-design" / "ontology-validator-registry.json"


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_runtime_design_map_covers_registry_exactly_once() -> None:
    mappings = _load_json(MAP_PATH)["mappings"]
    mapped_runtime_ids = [item["runtimeValidatorId"] for item in mappings]
    runtime_ids = {spec.validator_id for spec in build_registry().all()}

    assert len(mapped_runtime_ids) == len(set(mapped_runtime_ids))
    assert set(mapped_runtime_ids) == runtime_ids


def test_runtime_design_map_targets_existing_design_items() -> None:
    mapping_document = _load_json(MAP_PATH)
    design_registry = _load_json(DESIGN_REGISTRY_PATH)
    design_ids = [
        validator["id"]
        for chapter in design_registry["chapters"]
        for validator in chapter["validators"]
    ]
    mapped_design_ids = {
        design_id
        for mapping in mapping_document["mappings"]
        for design_id in mapping["designValidatorIds"]
    }

    assert len(design_ids) == len(set(design_ids))
    assert mapped_design_ids <= set(design_ids)
