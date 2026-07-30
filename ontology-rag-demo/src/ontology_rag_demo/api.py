from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from .services import RagServices
from .settings import Settings

app = FastAPI(title="Ontology RAG Demo", version="0.1.0")
GraphAlgorithm = Literal["minimum_connected_subgraph"]


class QuestionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    top_k: int | None = Field(default=None, ge=1, le=20)
    trace: bool = False


class GraphQuestionRequest(QuestionRequest):
    graph_algorithm: GraphAlgorithm = "minimum_connected_subgraph"


class OagRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    keywords: list[str] = Field(min_length=1, max_length=10)
    top_k: int | None = Field(default=None, ge=1, le=20)
    graph_algorithm: GraphAlgorithm = "minimum_connected_subgraph"

    @field_validator("keywords")
    @classmethod
    def normalize_keywords(cls, keywords: list[str]) -> list[str]:
        normalized = [keyword.strip() for keyword in keywords]
        if any(not keyword or len(keyword) > 200 for keyword in normalized):
            raise ValueError("keywords must contain between 1 and 200 characters")
        return normalized


@lru_cache(maxsize=1)
def get_services() -> RagServices:
    return RagServices()


@app.get("/health")
def health() -> dict[str, object]:
    settings = Settings()
    summary = settings.safe_summary()
    ontology_path = settings.resolved_ontology_path
    if ontology_path.is_file():
        try:
            summary["ontology_sha256"] = file_sha256(ontology_path)
        except OSError:
            summary["ontology_ready"] = False
    try:
        summary["vector_index_ready"] = LanceIndexProbe(settings).ready()
    except Exception:
        summary["vector_index_ready"] = False
    return {"status": "ok", **summary}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


@app.post("/v1/retrieval/vector")
def vector_retrieval(request: QuestionRequest) -> dict[str, object]:
    try:
        hits = get_services().vector_retrieve(request.question, request.top_k)
        return {"question": request.question, "hits": hits}
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Vector retrieval is unavailable; check the local index and embedding setup",
        ) from exc


@app.post("/v1/retrieval/graph")
def graph_retrieval(request: GraphQuestionRequest) -> dict[str, object]:
    try:
        result = get_services().graph_retrieve(
            request.question,
            request.graph_algorithm,
        )
        return {
            "question": request.question,
            "graph_algorithm": request.graph_algorithm,
            **result.as_dict(),
        }
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Graph retrieval is unavailable; check the prepared ontology",
        ) from exc


@app.post("/v1/retrieval/oag")
def oag_retrieval(request: OagRequest) -> dict[str, object]:
    try:
        hits, graph = get_services().oag_retrieve(
            request.keywords,
            request.top_k,
            request.graph_algorithm,
        )
        return {
            "question": request.question,
            "keywords": request.keywords,
            "graph_algorithm": request.graph_algorithm,
            "hits": hits,
            "graph": graph.as_dict(),
        }
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="OAG retrieval is unavailable; check the local index and ontology",
        ) from exc


@app.post("/v1/answer")
async def answer(request: GraphQuestionRequest) -> dict[str, object]:
    try:
        answer_text, vector_hits, graph_result = await get_services().answer(
            request.question,
            request.graph_algorithm,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Answer generation is unavailable; check runtime configuration",
        ) from exc

    response: dict[str, object] = {
        "question": request.question,
        "answer": answer_text,
    }
    if request.trace:
        response["trace"] = {
            "vector_hits": vector_hits,
            "graph": graph_result.as_dict(),
            "graph_algorithm": request.graph_algorithm,
        }
    return response


class LanceIndexProbe:
    """Keep the health route from loading the embedding model or ontology."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def ready(self) -> bool:
        from .vector_store import LanceDBVectorStore

        return LanceDBVectorStore(
            self.settings.resolved_lancedb_uri,
            self.settings.lancedb_table,
        ).exists()
