from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TextIO
from urllib.error import URLError
from urllib.request import Request, urlopen

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "deepseek/deepseek-v4-flash"
DEFAULT_QUESTION = "温度传感器所在的房间属于哪个建筑？"
OAG_BASE_URL = "http://127.0.0.1:8010"


@dataclass(frozen=True)
class Baseline:
    id: str
    agent: str
    profile: Path

    @property
    def config(self) -> Path:
        return self.profile / "opencode" / "opencode.jsonc"


BASELINES = {
    "oag": Baseline(
        id="oag",
        agent="oag-query-planner",
        profile=PROJECT_ROOT / "profiles" / "baseline-oag",
    ),
    "direct-context": Baseline(
        id="direct-context",
        agent="ontology-direct-context",
        profile=PROJECT_ROOT / "profiles" / "baseline-direct-context",
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the two ontology query-planning baselines with OpenCode."
    )
    parser.add_argument(
        "--baseline",
        choices=["all", *BASELINES],
        default="all",
    )
    parser.add_argument("--question", default=DEFAULT_QUESTION)
    parser.add_argument(
        "--embedding-device",
        choices=["cpu", "mps"],
        default="cpu",
    )
    parser.add_argument(
        "--skip-index",
        action="store_true",
        help="Reuse the existing BGE-M3 LanceDB index.",
    )
    parser.add_argument(
        "--artifacts-root",
        type=Path,
        default=PROJECT_ROOT / "artifacts" / "baselines",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    question = args.question.strip()
    if not question:
        raise RuntimeError("Question must not be empty")

    opencode = shutil.which("opencode")
    if not opencode:
        raise RuntimeError("OpenCode is not installed or is not on PATH")
    assert_model_available(opencode)

    run_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    run_directory = args.artifacts_root.resolve() / run_id
    run_directory.mkdir(parents=True, exist_ok=False)

    selected = list(BASELINES) if args.baseline == "all" else [args.baseline]
    results: dict[str, dict[str, object]] = {}
    oag_process: subprocess.Popen[str] | None = None
    oag_log: TextIO | None = None
    try:
        if "oag" in selected:
            oag_environment = build_oag_environment(args.embedding_device)
            if not args.skip_index:
                prepare_oag_index(oag_environment)
            assert_oag_port_available()
            oag_process, oag_log = start_oag(run_directory, oag_environment)
            health = wait_for_oag(oag_process)
            (run_directory / "oag-health.json").write_text(
                f"{json.dumps(health, ensure_ascii=False, indent=2)}\n",
                encoding="utf-8",
            )
            preflight = validate_oag_contract()
            (run_directory / "oag-preflight.json").write_text(
                f"{json.dumps(preflight, ensure_ascii=False, indent=2)}\n",
                encoding="utf-8",
            )

        for baseline_id in selected:
            print(f"\n=== {baseline_id} ===", flush=True)
            result = run_baseline(
                opencode,
                BASELINES[baseline_id],
                question,
                run_directory,
            )
            results[baseline_id] = result
            print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    finally:
        if oag_process is not None:
            stop_process(oag_process)
        if oag_log is not None:
            oag_log.close()

    manifest = {
        "schema_version": 1,
        "run_id": run_id,
        "model": MODEL_ID,
        "question": question,
        "baselines": selected,
        "results": results,
    }
    (run_directory / "manifest.json").write_text(
        f"{json.dumps(manifest, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )
    print(f"\nArtifacts: {run_directory}", flush=True)
    return 0


def assert_model_available(opencode: str) -> None:
    completed = subprocess.run(
        [opencode, "models", "deepseek"],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    available = {line.strip() for line in completed.stdout.splitlines()}
    if completed.returncode != 0 or MODEL_ID not in available:
        raise RuntimeError(
            f"Required OpenCode model {MODEL_ID} is unavailable; "
            "stop and configure it before running the baselines"
        )


def build_oag_environment(embedding_device: str) -> dict[str, str]:
    environment = os.environ.copy()
    environment.update(
        {
            "EMBEDDING_BACKEND": "bge-m3",
            "EMBEDDING_MODEL": "BAAI/bge-m3",
            "EMBEDDING_DEVICE": embedding_device,
            "EMBEDDING_BATCH_SIZE": "2",
            "EMBEDDING_NORMALIZE": "true",
            "LANCEDB_URI": "state/baseline-oag-bge-m3/lancedb",
            "LANCEDB_TABLE": "ontology_entities_v1",
            "VECTOR_TOP_K": "5",
            "API_HOST": "127.0.0.1",
            "API_PORT": "8010",
            "HF_HUB_DISABLE_XET": "1",
            "TOKENIZERS_PARALLELISM": "false",
        }
    )
    return environment


def prepare_oag_index(environment: dict[str, str]) -> None:
    ontology_rag = Path(sys.executable).with_name("ontology-rag")
    if not ontology_rag.is_file():
        raise RuntimeError("ontology-rag entry point is missing; run `uv sync --locked` first")
    for command in ("prepare", "build-index"):
        print(f"Running ontology-rag {command}...", flush=True)
        subprocess.run(
            [str(ontology_rag), command],
            cwd=PROJECT_ROOT,
            env=environment,
            check=True,
        )


def start_oag(
    run_directory: Path,
    environment: dict[str, str],
) -> tuple[subprocess.Popen[str], TextIO]:
    ontology_rag = Path(sys.executable).with_name("ontology-rag")
    log = (run_directory / "oag.log").open("w", encoding="utf-8")
    process = subprocess.Popen(
        [str(ontology_rag), "serve"],
        cwd=PROJECT_ROOT,
        env=environment,
        stdout=log,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return process, log


def assert_oag_port_available() -> None:
    try:
        with urlopen(f"{OAG_BASE_URL}/health", timeout=0.5):
            pass
    except (OSError, URLError):
        return
    raise RuntimeError(
        "Port 8010 is already serving another OAG process; stop it before running "
        "this isolated baseline"
    )


def wait_for_oag(
    process: subprocess.Popen[str],
    timeout_seconds: float = 30.0,
) -> dict[str, object]:
    deadline = time.monotonic() + timeout_seconds
    health_url = f"{OAG_BASE_URL}/health"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"OAG exited during startup with code {process.returncode}")
        try:
            with urlopen(health_url, timeout=1.0) as response:
                health = json.loads(response.read())
            if (
                health.get("status") == "ok"
                and health.get("vector_index_ready")
                and health.get("embedding_backend") == "bge-m3"
            ):
                return health
        except (OSError, URLError, json.JSONDecodeError):
            pass
        time.sleep(0.2)
    raise RuntimeError("OAG did not become ready before the startup timeout")


def validate_oag_contract() -> dict[str, object]:
    payload = json.dumps(
        {
            "question": DEFAULT_QUESTION,
            "keywords": ["温度传感器", "房间", "建筑"],
            "top_k": 5,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = Request(
        f"{OAG_BASE_URL}/v1/retrieval/oag",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=180) as response:
        result = json.loads(response.read())

    hits = result.get("hits")
    graph = result.get("graph")
    if not isinstance(hits, list) or len(hits) != 5:
        raise RuntimeError("OAG preflight did not return exactly five vector hits")
    if not isinstance(graph, dict):
        raise RuntimeError("OAG preflight did not return a graph")
    hit_ids = [
        hit.get("id") for hit in hits if isinstance(hit, dict) and isinstance(hit.get("id"), str)
    ]
    anchors = graph.get("anchors")
    anchor_items = anchors if isinstance(anchors, list) else []
    anchor_ids = [
        anchor.get("id")
        for anchor in anchor_items
        if isinstance(anchor, dict) and isinstance(anchor.get("id"), str)
    ]
    if len(hit_ids) != 5 or anchor_ids != hit_ids:
        raise RuntimeError("OAG preflight graph anchors do not match the Top-5 hits")
    if any(
        not isinstance(hit, dict)
        or hit.get("content_type") != "ontology_entity"
        or not isinstance(hit.get("text"), str)
        or hit["text"].count("\n") != 2
        for hit in hits
    ):
        raise RuntimeError("OAG preflight detected a stale or mixed vector index")
    return result


def run_baseline(
    opencode: str,
    baseline: Baseline,
    question: str,
    run_directory: Path,
) -> dict[str, object]:
    baseline_directory = run_directory / baseline.id
    baseline_directory.mkdir()
    environment = os.environ.copy()
    environment.update(
        {
            "OPENCODE_CONFIG": str(baseline.config),
            "ONTOLOGY_PROFILE_DIR": str(baseline.profile),
            "ONTOLOGY_MODEL_ID": MODEL_ID,
            "ONTOLOGY_RETRIEVAL_ENDPOINT": OAG_BASE_URL,
            "ONTOLOGY_VECTOR_TOP_K": "5",
            "ONTOLOGY_GRAPH_ALGORITHM": "minimum_connected_subgraph",
        }
    )
    command = [
        opencode,
        "run",
        "--pure",
        "--model",
        MODEL_ID,
        "--agent",
        baseline.agent,
        "--format",
        "json",
        question,
    ]
    started = time.monotonic()
    completed = subprocess.run(
        command,
        cwd=PROJECT_ROOT,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
        timeout=600,
    )
    duration_ms = round((time.monotonic() - started) * 1000)
    (baseline_directory / "trace.jsonl").write_text(
        completed.stdout,
        encoding="utf-8",
    )
    (baseline_directory / "stderr.log").write_text(
        completed.stderr,
        encoding="utf-8",
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"OpenCode baseline {baseline.id} failed with code {completed.returncode}; "
            f"see {baseline_directory / 'stderr.log'}"
        )

    result = extract_result(completed.stdout)
    if result.get("schema_version") != "data-query-plan.v1":
        raise RuntimeError(f"Baseline {baseline.id} returned an unexpected schema")
    if result.get("baseline") != baseline.id:
        raise RuntimeError(f"Baseline {baseline.id} mislabeled its result")
    (baseline_directory / "result.json").write_text(
        f"{json.dumps(result, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )
    metadata = {
        "baseline": baseline.id,
        "model": MODEL_ID,
        "agent": baseline.agent,
        "duration_ms": duration_ms,
        "exit_code": completed.returncode,
    }
    (baseline_directory / "metadata.json").write_text(
        f"{json.dumps(metadata, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )
    return {**metadata, "output": result}


def extract_result(trace: str) -> dict[str, object]:
    text_parts: list[str] = []
    for line in trace.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") != "text":
            continue
        part = event.get("part")
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            text_parts.append(part["text"])
    if not text_parts:
        raise RuntimeError("OpenCode trace did not contain a final text response")

    candidate = "".join(text_parts).strip()
    for json_candidate in json_response_candidates(candidate):
        try:
            result = json.loads(json_candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(result, dict):
            raise RuntimeError("OpenCode final response must be a JSON object")
        return result
    raise RuntimeError("OpenCode final response does not contain a valid JSON object")


def json_response_candidates(response: str) -> list[str]:
    """Return strict-to-tolerant JSON candidates from an Agent text response."""
    candidates = [response.strip()]
    cursor = 0
    while True:
        fence_start = response.find("```", cursor)
        if fence_start < 0:
            break
        header_end = response.find("\n", fence_start + 3)
        if header_end < 0:
            break
        language = response[fence_start + 3 : header_end].strip().lower()
        fence_end = response.find("```", header_end + 1)
        if fence_end < 0:
            break
        if language in {"", "json"}:
            candidates.append(response[header_end + 1 : fence_end].strip())
        cursor = fence_end + 3

    object_start = response.find("{")
    object_end = response.rfind("}")
    if 0 <= object_start < object_end:
        candidates.append(response[object_start : object_end + 1].strip())

    return list(dict.fromkeys(candidate for candidate in candidates if candidate))


def stop_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"baseline run failed: {error}", file=sys.stderr)
        raise SystemExit(2) from error
