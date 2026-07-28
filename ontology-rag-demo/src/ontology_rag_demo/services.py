from __future__ import annotations

from functools import cached_property

from .embedding import Embedder, build_embedder
from .llm import QwenClient
from .ontology import GraphRetrievalResult, OntologyGraph
from .settings import Settings
from .vector_store import LanceDBVectorStore


class RagServices:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or Settings()

    @cached_property
    def embedder(self) -> Embedder:
        return build_embedder(self.settings)

    @cached_property
    def ontology(self) -> OntologyGraph:
        return OntologyGraph.from_file(self.settings.resolved_ontology_path)

    @cached_property
    def vector_store(self) -> LanceDBVectorStore:
        return LanceDBVectorStore(
            self.settings.resolved_lancedb_uri,
            self.settings.lancedb_table,
        )

    @cached_property
    def qwen(self) -> QwenClient:
        return QwenClient(self.settings)

    def vector_retrieve(self, question: str, top_k: int | None = None) -> list[dict]:
        vector = self.embedder.encode([question])[0]
        return self.vector_store.search(
            vector,
            top_k=top_k or self.settings.vector_top_k,
        )

    def graph_retrieve(self, question: str) -> GraphRetrievalResult:
        return self.ontology.retrieve(
            question,
            max_anchors=self.settings.graph_max_anchors,
            max_nodes=self.settings.graph_max_nodes,
        )

    def oag_retrieve(
        self,
        keywords: list[str],
        top_k: int | None = None,
    ) -> tuple[list[dict], GraphRetrievalResult]:
        embedding_query = "\n".join(keyword.strip() for keyword in keywords if keyword.strip())
        if not embedding_query:
            raise ValueError("At least one non-empty keyword is required")

        vector_hits = self.vector_retrieve(embedding_query, top_k)
        anchor_ids = [
            hit["id"]
            for hit in vector_hits
            if hit.get("content_type") == "ontology_entity" and isinstance(hit.get("id"), str)
        ]
        graph_result = self.ontology.retrieve_by_anchor_ids(
            anchor_ids,
            max_nodes=self.settings.graph_max_nodes,
        )
        return vector_hits, graph_result

    async def answer(self, question: str) -> tuple[str, list[dict], GraphRetrievalResult]:
        vector_hits = self.vector_retrieve(question)
        graph_result = self.graph_retrieve(question)
        answer = await self.qwen.answer(question, vector_hits, graph_result)
        return answer, vector_hits, graph_result
