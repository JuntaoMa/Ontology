from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .services import RagServices
from .settings import Settings

app = FastAPI(title="Ontology RAG Demo", version="0.1.0")


class QuestionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    top_k: int | None = Field(default=None, ge=1, le=20)
    trace: bool = False


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
def graph_retrieval(request: QuestionRequest) -> dict[str, object]:
    try:
        result = get_services().graph_retrieve(request.question)
        return {"question": request.question, **result.as_dict()}
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Graph retrieval is unavailable; check the prepared ontology",
        ) from exc


@app.post("/v1/answer")
async def answer(request: QuestionRequest) -> dict[str, object]:
    try:
        answer_text, vector_hits, graph_result = await get_services().answer(request.question)
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
