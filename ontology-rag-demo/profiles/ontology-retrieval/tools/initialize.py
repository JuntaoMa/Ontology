from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict
from pathlib import Path

PROFILE_DIR = Path(__file__).resolve().parents[1]
if str(PROFILE_DIR) not in sys.path:
    sys.path.insert(0, str(PROFILE_DIR))

from retrieval import EmbeddingConfig, build_index  # noqa: E402


def main() -> int:
    runtime_root = required_directory("ONTOLOGY_RUNTIME_ROOT")
    profile_dir = required_directory("ONTOLOGY_PROFILE_DIR")
    dataset_dir = required_directory("ONTOLOGY_DATASET_DIR")
    generated_dir = required_directory("ONTOLOGY_GENERATED_DIR")
    state_dir = required_directory("ONTOLOGY_RUNTIME_STATE_DIR")
    ontology_path = required_file("ONTOLOGY_PATH")

    assert_within(profile_dir, Path(__file__).resolve(), "initializer script")
    assert_within(dataset_dir, ontology_path, "ontology snapshot")
    assert_within(runtime_root, profile_dir, "Profile snapshot")
    assert_within(runtime_root, dataset_dir, "Dataset snapshot")
    assert_within(runtime_root, generated_dir, "generated directory")
    assert_within(runtime_root, state_dir, "Runtime state directory")

    metadata = build_index(
        ontology_path,
        state_dir,
        EmbeddingConfig.from_environment(),
    )
    result = {
        "schema_version": 1,
        "profile": "ontology-retrieval",
        "index": asdict(metadata),
        "generated": ["retrieval-initializer-result.json"],
    }
    write_json_atomic(generated_dir / "retrieval-initializer-result.json", result)
    print(json.dumps(result, ensure_ascii=False))
    return 0


def required_directory(name: str) -> Path:
    path = required_path(name)
    if not path.is_dir():
        raise RuntimeError(f"{name} must point to an existing directory")
    return path


def required_file(name: str) -> Path:
    path = required_path(name)
    if not path.is_file():
        raise RuntimeError(f"{name} must point to an existing file")
    return path


def required_path(name: str) -> Path:
    raw = os.environ.get(name, "").strip()
    if not raw:
        raise RuntimeError(f"{name} is required")
    return Path(raw).resolve()


def assert_within(root: Path, candidate: Path, label: str) -> None:
    try:
        candidate.resolve().relative_to(root.resolve())
    except ValueError as error:
        raise RuntimeError(f"{label} escapes the Runtime boundary") from error


def write_json_atomic(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


if __name__ == "__main__":
    raise SystemExit(main())
