from pathlib import Path

from ontology_rag_demo.embedding import DeterministicEmbedder
from ontology_rag_demo.ingestion import Chunk
from ontology_rag_demo.vector_store import LanceDBVectorStore


def test_rebuild_and_exact_search(tmp_path: Path) -> None:
    chunks = [
        Chunk("sensor", "A temperature sensor measures room temperature", "test.txt", 0),
        Chunk("alert", "An alert creates an operations work order", "test.txt", 1),
        Chunk("room", "A room is part of a building", "test.txt", 2),
    ]
    embedder = DeterministicEmbedder()
    vectors = embedder.encode([chunk.text for chunk in chunks])
    store = LanceDBVectorStore(tmp_path / "lancedb", "chunks")
    store.rebuild(chunks, vectors)

    hits = store.search(
        embedder.encode(["An alert creates an operations work order"])[0],
        top_k=2,
    )

    assert len(hits) == 2
    assert hits[0]["id"] == "alert"
    assert hits[0]["distance"] <= hits[1]["distance"]
