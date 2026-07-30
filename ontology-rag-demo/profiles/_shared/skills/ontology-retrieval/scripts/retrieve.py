from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ARTIFACT_PREFIX = "ONTOLOGY_ARTIFACT:"
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
ENDPOINTS = {
    "vector": "/v1/retrieval/vector",
    "graph": "/v1/retrieval/graph",
    "oag": "/v1/retrieval/oag",
    "answer": "/v1/answer",
}
SHA256_HEX_LENGTH = 64
SUPPORTED_GRAPH_ALGORITHMS = {"minimum_connected_subgraph"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Call the configured ontology RAG service.")
    parser.add_argument("--mode", choices=sorted(ENDPOINTS), required=True)
    parser.add_argument("--question", required=True)
    parser.add_argument("--keyword", action="append", default=[])
    parser.add_argument("--top-k", type=int)
    parser.add_argument("--timeout-seconds", type=float, default=60.0)
    args = parser.parse_args()
    if args.top_k is None:
        configured_top_k = os.environ.get("ONTOLOGY_VECTOR_TOP_K", "5").strip()
        try:
            args.top_k = int(configured_top_k)
        except ValueError:
            parser.error("ONTOLOGY_VECTOR_TOP_K must be an integer")
    question = args.question.strip()
    if not question or len(question) > 4000:
        parser.error("--question must contain between 1 and 4000 characters")
    if not 1 <= args.top_k <= 20:
        parser.error("--top-k must be between 1 and 20")
    if not 0 < args.timeout_seconds <= 300:
        parser.error("--timeout-seconds must be greater than 0 and at most 300")
    keywords = [keyword.strip() for keyword in args.keyword]
    if args.mode == "oag" and not keywords:
        parser.error("--mode oag requires at least one --keyword")
    if any(not keyword or len(keyword) > 200 for keyword in keywords):
        parser.error("--keyword must contain between 1 and 200 characters")
    graph_algorithm = (
        os.environ.get(
            "ONTOLOGY_GRAPH_ALGORITHM",
            "minimum_connected_subgraph",
        ).strip()
        or "minimum_connected_subgraph"
    )
    if graph_algorithm not in SUPPORTED_GRAPH_ALGORITHMS:
        parser.error("ONTOLOGY_GRAPH_ALGORITHM is not supported")
    args.question = question
    args.keyword = keywords
    args.graph_algorithm = graph_algorithm
    return args


def service_base_url() -> str:
    base_url = os.environ.get("ONTOLOGY_RETRIEVAL_ENDPOINT", "").strip().rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError("ONTOLOGY_RETRIEVAL_ENDPOINT is missing or is not an HTTP(S) base URL")
    return base_url


def service_url(mode: str) -> str:
    return f"{service_base_url()}{ENDPOINTS[mode]}"


def health_url() -> str:
    return f"{service_base_url()}/health"


def read_json_response(
    request: Request,
    timeout_seconds: float,
    operation: str,
) -> dict[str, Any]:
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError as error:
        raise RuntimeError(f"Ontology RAG {operation} returned HTTP {error.code}") from error
    except URLError as error:
        raise RuntimeError("Ontology RAG service is unreachable") from error

    if len(body) > MAX_RESPONSE_BYTES:
        raise RuntimeError(f"Ontology RAG {operation} exceeds the 4 MiB safety limit")
    try:
        result = json.loads(body)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Ontology RAG {operation} returned invalid JSON") from error
    if not isinstance(result, dict):
        raise RuntimeError(f"Ontology RAG {operation} returned a non-object JSON value")
    return result


def request_json(
    url: str,
    payload: dict[str, Any],
    timeout_seconds: float,
) -> dict[str, Any]:
    request = Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return read_json_response(request, timeout_seconds, "service response")


def validate_ontology_digest(timeout_seconds: float) -> None:
    configured_digest = os.environ.get("ONTOLOGY_EXPECTED_SHA256", "").strip()
    if not configured_digest:
        return
    expected_digest = configured_digest.lower()
    if not is_sha256(expected_digest):
        raise RuntimeError("Configured ontology digest is invalid")

    request = Request(health_url(), method="GET")
    health = read_json_response(request, timeout_seconds, "health check")
    reported_digest = health.get("ontology_sha256")
    if not isinstance(reported_digest, str) or not is_sha256(reported_digest):
        raise RuntimeError("Ontology RAG service did not report a valid ontology digest")
    if reported_digest.lower() != expected_digest:
        raise RuntimeError("Ontology digest mismatch; retrieval was refused")


def is_sha256(value: str) -> bool:
    return len(value) == SHA256_HEX_LENGTH and all(
        character in "0123456789abcdef" for character in value.lower()
    )


def graph_from_response(mode: str, response: dict[str, Any]) -> dict[str, Any] | None:
    if mode == "graph":
        return response
    if mode == "oag":
        graph = response.get("graph")
        return graph if isinstance(graph, dict) else None
    if mode != "answer":
        return None
    trace = response.get("trace")
    if not isinstance(trace, dict):
        return None
    graph = trace.get("graph")
    return graph if isinstance(graph, dict) else None


def confirm_graph_algorithm(
    mode: str,
    response: dict[str, Any],
    expected: str,
) -> str:
    if mode == "answer":
        trace = response.get("trace")
        reported = trace.get("graph_algorithm") if isinstance(trace, dict) else None
    else:
        reported = response.get("graph_algorithm")
    if reported != expected:
        raise RuntimeError(
            "Ontology RAG service did not confirm the requested graph algorithm"
        )
    return expected


def to_artifact(
    question: str,
    graph: dict[str, Any],
    duration_ms: int,
    graph_algorithm: str,
) -> dict[str, Any]:
    anchors = graph.get("anchors")
    raw_nodes = graph.get("nodes")
    raw_edges = graph.get("edges")
    anchor_items = anchors if isinstance(anchors, list) else []
    node_items = raw_nodes if isinstance(raw_nodes, list) else []
    anchor_ids = {
        item["id"]
        for item in anchor_items
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    nodes = [
        {
            "id": node["id"],
            "label": node.get("label", node["id"]),
            "type": "OntologyEntity",
            "anchor": node["id"] in anchor_ids,
        }
        for node in node_items
        if isinstance(node, dict)
        and isinstance(node.get("id"), str)
        and isinstance(node.get("label", node["id"]), str)
    ]
    edges: list[dict[str, str]] = []
    if isinstance(raw_edges, list):
        for edge in raw_edges:
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
                edges.append(
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
        "nodes": nodes,
        "edges": edges,
        "metadata": {
            "algorithm": graph_algorithm,
            "anchor_nodes": sorted(anchor_ids),
            "node_count": len(nodes),
            "edge_count": len(edges),
            "duration_ms": duration_ms,
            "disconnected": bool(graph.get("disconnected", False)),
        },
    }


def main() -> int:
    args = parse_args()
    validate_ontology_digest(args.timeout_seconds)
    payload: dict[str, Any] = {
        "question": args.question,
        "top_k": args.top_k,
    }
    if args.mode == "answer":
        payload["trace"] = True
    if args.mode == "oag":
        payload["keywords"] = args.keyword
    if args.mode in {"graph", "oag", "answer"}:
        payload["graph_algorithm"] = args.graph_algorithm
    started = time.monotonic()
    response = request_json(
        service_url(args.mode),
        payload,
        args.timeout_seconds,
    )
    duration_ms = round((time.monotonic() - started) * 1000)
    graph = graph_from_response(args.mode, response)
    if graph is not None:
        graph_algorithm = confirm_graph_algorithm(
            args.mode,
            response,
            args.graph_algorithm,
        )
        artifact = to_artifact(
            args.question,
            graph,
            duration_ms,
            graph_algorithm,
        )
        print(f"{ARTIFACT_PREFIX}{json.dumps(artifact, ensure_ascii=False)}")
    print(json.dumps(response, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError) as error:
        print(f"ontology retrieval failed: {error}", file=sys.stderr)
        raise SystemExit(2) from error
