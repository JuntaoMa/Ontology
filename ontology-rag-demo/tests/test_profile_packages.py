from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from rdflib import OWL, RDF, RDFS, Graph, Literal, Namespace

PROJECT_ROOT = Path(__file__).parents[1]
DATASET_SOURCE = PROJECT_ROOT / "datasets" / "smart-building"
ARTIFACT_PREFIX = "ONTOLOGY_ARTIFACT:"


def load_retrieval_engine():
    module_path = (
        PROJECT_ROOT
        / "profiles"
        / "ontology-retrieval"
        / "retrieval"
        / "engine.py"
    )
    spec = importlib.util.spec_from_file_location("ontology_retrieval_engine", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    previous_bytecode_setting = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous_bytecode_setting
    return module


def materialize_runtime(tmp_path: Path, profile_id: str) -> tuple[Path, dict[str, str]]:
    runtime_root = tmp_path / f"{profile_id}--smart-building"
    workspace = runtime_root / "workspace"
    profile_dir = workspace / "profile"
    dataset_dir = workspace / "dataset"
    generated_dir = workspace / "generated"
    state_dir = runtime_root / "state"
    shutil.copytree(PROJECT_ROOT / "profiles" / profile_id, profile_dir)
    shutil.copytree(DATASET_SOURCE, dataset_dir)
    generated_dir.mkdir(parents=True)
    state_dir.mkdir(parents=True)
    ontology_path = dataset_dir / "building.ttl"

    environment = os.environ.copy()
    environment.update(
        {
            "ONTOLOGY_DEMO_ROOT": str(PROJECT_ROOT),
            "ONTOLOGY_RUNTIME_ID": runtime_root.name,
            "ONTOLOGY_RUNTIME_ROOT": str(runtime_root),
            "ONTOLOGY_WORKSPACE_DIR": str(workspace),
            "ONTOLOGY_PROFILE_DIR": str(profile_dir),
            "ONTOLOGY_DATASET_DIR": str(dataset_dir),
            "ONTOLOGY_GENERATED_DIR": str(generated_dir),
            "ONTOLOGY_RUNTIME_STATE_DIR": str(state_dir),
            "ONTOLOGY_PATH": str(ontology_path),
            "ONTOLOGY_ID": "smart-building",
            "ONTOLOGY_EXPECTED_SHA256": hashlib.sha256(
                ontology_path.read_bytes()
            ).hexdigest(),
            "EMBEDDING_BACKEND": "deterministic",
        }
    )
    return runtime_root, environment


def run_script(path: Path, environment: dict[str, str], *arguments: str) -> str:
    result = subprocess.run(
        [sys.executable, str(path), *arguments],
        check=True,
        capture_output=True,
        text=True,
        env=environment,
        timeout=60,
    )
    return result.stdout


def test_direct_context_initializer_renders_dataset_ontology(tmp_path: Path) -> None:
    runtime_root, environment = materialize_runtime(tmp_path, "direct-context")
    profile_dir = runtime_root / "workspace" / "profile"

    output = run_script(profile_dir / "tools" / "initialize.py", environment)

    result = json.loads(output)
    prompt = (profile_dir / "opencode" / "prompt.md").read_text(encoding="utf-8")
    context = (
        runtime_root / "workspace" / "generated" / "ontology-context.yaml"
    ).read_text(encoding="utf-8")
    assert result["profile"] == "direct-context"
    assert result["entity_count"] == 11
    assert "{{ONTOLOGY_CONTEXT}}" not in prompt
    assert 'name: "TemperatureSensor"' in prompt
    assert 'name: "locatedIn"' in context


def test_direct_context_profile_does_not_embed_sample_dataset_terms() -> None:
    template = (
        PROJECT_ROOT
        / "profiles"
        / "direct-context"
        / "opencode"
        / "prompt.template.md"
    ).read_text(encoding="utf-8")

    for dataset_specific_term in (
        "smart-building",
        "TemperatureSensor",
        "raisesAlert",
        "locatedIn",
        "example.test/building",
    ):
        assert dataset_specific_term not in template


def test_retrieval_profile_builds_and_queries_runtime_local_index(
    tmp_path: Path,
) -> None:
    runtime_root, environment = materialize_runtime(tmp_path, "ontology-retrieval")
    profile_dir = runtime_root / "workspace" / "profile"
    state_dir = runtime_root / "state"

    initializer_output = run_script(
        profile_dir / "tools" / "initialize.py",
        environment,
    )
    initializer_result = json.loads(initializer_output)
    metadata = json.loads(
        (state_dir / "retrieval" / "metadata.json").read_text(encoding="utf-8")
    )

    wrapper_output = run_script(
        profile_dir
        / "skills"
        / "ontology-retrieval"
        / "scripts"
        / "retrieve.py",
        environment,
        "--question",
        "温度传感器位于哪个建筑？",
        "--keyword",
        "温度传感器",
        "--keyword",
        "建筑",
    )
    lines = wrapper_output.splitlines()
    artifact = json.loads(lines[0].removeprefix(ARTIFACT_PREFIX))
    response = json.loads("\n".join(lines[1:]))

    assert initializer_result["profile"] == "ontology-retrieval"
    assert metadata["embedding_backend"] == "deterministic"
    assert metadata["embedding_model"] == "deterministic-hash-v1"
    assert metadata["entity_count"] == 11
    assert len(response["hits"]) == 5
    assert all(len(hit["text"].splitlines()) == 3 for hit in response["hits"])
    assert response["graph_algorithm"] == "minimum_connected_subgraph"
    assert (
        response["graph_implementation"]
        == "networkx.approximation.steiner_tree:mehlhorn"
    )
    assert response["index"]["vector_top_k"] == 5
    assert "embedding_model" not in response["index"]
    assert artifact["kind"] == "ontology.subgraph"
    assert artifact["metadata"]["anchor_nodes"]


def test_skill_rejects_a_runtime_path_outside_the_runtime_root(
    tmp_path: Path,
) -> None:
    runtime_root, environment = materialize_runtime(tmp_path, "ontology-retrieval")
    profile_dir = runtime_root / "workspace" / "profile"
    environment["ONTOLOGY_RUNTIME_STATE_DIR"] = str(tmp_path.parent)

    result = subprocess.run(
        [
            sys.executable,
            str(
                profile_dir
                / "skills"
                / "ontology-retrieval"
                / "scripts"
                / "retrieve.py"
            ),
            "--question",
            "温度传感器在哪？",
            "--keyword",
            "温度传感器",
        ],
        capture_output=True,
        text=True,
        env=environment,
        timeout=30,
    )

    assert result.returncode == 2
    assert "escapes the Runtime boundary" in result.stderr


def test_direct_initializer_cannot_write_to_the_source_profile(tmp_path: Path) -> None:
    _, environment = materialize_runtime(tmp_path, "direct-context")
    source_profile = PROJECT_ROOT / "profiles" / "direct-context"
    environment["ONTOLOGY_PROFILE_DIR"] = str(source_profile)

    result = subprocess.run(
        [sys.executable, str(source_profile / "tools" / "initialize.py")],
        capture_output=True,
        text=True,
        env=environment,
        timeout=30,
    )

    assert result.returncode != 0
    assert "escapes the Runtime profile snapshot" in result.stderr


def test_connected_subgraph_refuses_a_disconnected_node_limit_truncation() -> None:
    engine = load_retrieval_engine()
    namespace = Namespace("https://example.test/chain#")
    graph = Graph()
    for index in range(101):
        node = namespace[f"Node{index}"]
        graph.add((node, RDF.type, OWL.Class))
        graph.add((node, RDFS.label, Literal(f"Node {index}")))
        if index:
            graph.add((namespace[f"Node{index - 1}"], RDFS.subClassOf, node))

    ontology = engine.OntologyGraph(graph)
    with pytest.raises(RuntimeError, match="refusing to return a disconnected truncation"):
        ontology.retrieve_by_anchor_ids(
            [str(namespace.Node0), str(namespace.Node100)],
            max_nodes=80,
        )


def test_connected_subgraph_preserves_ontology_statement_direction() -> None:
    engine = load_retrieval_engine()
    namespace = "https://example.org/smart-building#"
    ontology = engine.OntologyGraph.from_file(DATASET_SOURCE / "building.ttl")

    result = ontology.retrieve_by_anchor_ids(
        [
            f"{namespace}Device",
            f"{namespace}Room",
            f"{namespace}Building",
        ],
        max_nodes=80,
    ).as_dict()
    edges = {
        (edge["source"], edge["target"]): set(edge["relations"])
        for edge in result["edges"]
    }

    assert "locatedIn" in edges[(f"{namespace}Device", f"{namespace}Room")]
    assert "partOfBuilding" in edges[(f"{namespace}Room", f"{namespace}Building")]
    assert (f"{namespace}Room", f"{namespace}Device") not in edges
    assert (f"{namespace}Building", f"{namespace}Room") not in edges


@pytest.mark.parametrize("profile_id", ["direct-context", "ontology-retrieval"])
def test_profile_package_contains_no_symbolic_links(profile_id: str) -> None:
    profile_dir = PROJECT_ROOT / "profiles" / profile_id

    assert not [path for path in profile_dir.rglob("*") if path.is_symlink()]
