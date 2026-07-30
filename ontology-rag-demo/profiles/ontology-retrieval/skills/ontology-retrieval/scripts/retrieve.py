from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

PROFILE_DIR = Path(__file__).resolve().parents[3]
if str(PROFILE_DIR) not in sys.path:
    sys.path.insert(0, str(PROFILE_DIR))

from retrieval import retrieve  # noqa: E402

ARTIFACT_PREFIX = "ONTOLOGY_ARTIFACT:"
MAX_QUESTION_CHARACTERS = 4000
MAX_KEYWORD_CHARACTERS = 200
MAX_TOP_K = 20
SUPPORTED_GRAPH_ALGORITHM = "minimum_connected_subgraph"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Retrieve ontology entities and an approximate Steiner connecting subgraph."
        )
    )
    parser.add_argument("--question", required=True)
    parser.add_argument("--keyword", action="append", default=[])
    parser.add_argument("--top-k", type=int)
    args = parser.parse_args()

    args.question = args.question.strip()
    args.keyword = [keyword.strip() for keyword in args.keyword]
    if not 1 <= len(args.question) <= MAX_QUESTION_CHARACTERS:
        parser.error(
            f"--question must contain between 1 and {MAX_QUESTION_CHARACTERS} characters"
        )
    if not args.keyword:
        parser.error("at least one --keyword is required")
    if any(
        not keyword or len(keyword) > MAX_KEYWORD_CHARACTERS
        for keyword in args.keyword
    ):
        parser.error(
            f"--keyword must contain between 1 and {MAX_KEYWORD_CHARACTERS} characters"
        )
    if args.top_k is not None and not 1 <= args.top_k <= MAX_TOP_K:
        parser.error(f"--top-k must be between 1 and {MAX_TOP_K}")

    configured_algorithm = os.environ.get(
        "ONTOLOGY_GRAPH_ALGORITHM",
        SUPPORTED_GRAPH_ALGORITHM,
    ).strip()
    if configured_algorithm != SUPPORTED_GRAPH_ALGORITHM:
        parser.error("ONTOLOGY_GRAPH_ALGORITHM is not supported by this Profile")
    return args


def main() -> int:
    args = parse_args()
    runtime_root = required_directory("ONTOLOGY_RUNTIME_ROOT")
    profile_dir = required_directory("ONTOLOGY_PROFILE_DIR")
    dataset_dir = required_directory("ONTOLOGY_DATASET_DIR")
    state_dir = required_directory("ONTOLOGY_RUNTIME_STATE_DIR")
    ontology_path = required_file("ONTOLOGY_PATH")

    assert_within(profile_dir, Path(__file__).resolve(), "Skill wrapper")
    assert_within(dataset_dir, ontology_path, "ontology snapshot")
    assert_within(runtime_root, profile_dir, "Profile snapshot")
    assert_within(runtime_root, dataset_dir, "Dataset snapshot")
    assert_within(runtime_root, state_dir, "Runtime state directory")

    started = time.monotonic()
    response = retrieve(
        ontology_path,
        state_dir,
        question=args.question,
        keywords=args.keyword,
        top_k=args.top_k,
    )
    duration_ms = round((time.monotonic() - started) * 1000)
    graph = response["graph"]
    if not isinstance(graph, dict):
        raise RuntimeError("retrieval engine returned an invalid graph")
    artifact = to_artifact(
        args.question,
        graph,
        duration_ms,
        SUPPORTED_GRAPH_ALGORITHM,
        str(response.get("graph_implementation", "unknown")),
    )
    print(f"{ARTIFACT_PREFIX}{json.dumps(artifact, ensure_ascii=False)}")
    print(json.dumps(response, ensure_ascii=False, indent=2))
    return 0


def to_artifact(
    question: str,
    graph: dict[str, Any],
    duration_ms: int,
    graph_algorithm: str,
    graph_implementation: str,
) -> dict[str, object]:
    raw_anchors = graph.get("anchors")
    raw_nodes = graph.get("nodes")
    raw_edges = graph.get("edges")
    anchors = raw_anchors if isinstance(raw_anchors, list) else []
    nodes = raw_nodes if isinstance(raw_nodes, list) else []
    edges = raw_edges if isinstance(raw_edges, list) else []
    anchor_ids = {
        item["id"]
        for item in anchors
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }

    artifact_nodes = [
        {
            "id": node["id"],
            "label": node.get("label", node["id"]),
            "type": node.get("entity_type", "OntologyEntity"),
            "anchor": node["id"] in anchor_ids,
        }
        for node in nodes
        if isinstance(node, dict)
        and isinstance(node.get("id"), str)
        and isinstance(node.get("label", node["id"]), str)
    ]
    artifact_edges: list[dict[str, str]] = []
    for edge in edges:
        if (
            not isinstance(edge, dict)
            or not isinstance(edge.get("source"), str)
            or not isinstance(edge.get("target"), str)
        ):
            continue
        relations = edge.get("relations")
        labels = (
            [value for value in relations if isinstance(value, str)]
            if isinstance(relations, list)
            else ["related"]
        )
        for label in labels or ["related"]:
            artifact_edges.append(
                {
                    "source": edge["source"],
                    "target": edge["target"],
                    "type": label,
                    "label": label,
                }
            )

    query_digest = hashlib.sha256(question.encode("utf-8")).hexdigest()[:16]
    return {
        "schema_version": 1,
        "kind": "ontology.subgraph",
        "query_id": f"q_{query_digest}",
        "nodes": artifact_nodes,
        "edges": artifact_edges,
        "metadata": {
            "algorithm": graph_algorithm,
            "implementation": graph_implementation,
            "anchor_nodes": sorted(anchor_ids),
            "node_count": len(artifact_nodes),
            "edge_count": len(artifact_edges),
            "duration_ms": duration_ms,
            "disconnected": bool(graph.get("disconnected", False)),
        },
    }


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


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError) as error:
        print(f"ontology retrieval failed: {error}", file=sys.stderr)
        raise SystemExit(2) from error
