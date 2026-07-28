from pathlib import Path

from ontology_rag_demo.services import RagServices
from ontology_rag_demo.settings import Settings


def test_oag_uses_top_five_vector_hits_as_graph_anchors(tmp_path: Path) -> None:
    settings = Settings(
        ontology_path=Path("examples/smart-building/ontology.ttl"),
        lancedb_uri=tmp_path / "lancedb",
        lancedb_table="ontology_entities_v1",
        embedding_backend="deterministic",
        vector_top_k=5,
    )
    services = RagServices(settings)
    chunks = services.ontology.entity_chunks()
    vectors = services.embedder.encode([chunk.text for chunk in chunks])
    services.vector_store.rebuild(chunks, vectors)

    hits, graph = services.oag_retrieve(["温度传感器", "房间", "建筑"])

    assert len(hits) == 5
    assert [anchor["id"] for anchor in graph.anchors] == [hit["id"] for hit in hits]
