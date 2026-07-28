from pathlib import Path

import lancedb

from ontology_rag_demo.cli import build_index, prepare
from ontology_rag_demo.settings import Settings


def test_prepare_copies_the_committed_sample(tmp_path: Path) -> None:
    settings = Settings(
        source_ontology_path=Path("examples/smart-building/ontology.ttl"),
        source_document_paths=("examples/smart-building/documents/operations-guide.txt"),
        ontology_path=tmp_path / "source" / "ontology.ttl",
        documents_dir=tmp_path / "source" / "documents",
    )

    prepare(settings)

    assert settings.resolved_ontology_path.is_file()
    assert (settings.resolved_documents_dir / "operations-guide.txt").is_file()


def test_build_index_contains_only_three_line_ontology_entities(tmp_path: Path) -> None:
    settings = Settings(
        ontology_path=Path("examples/smart-building/ontology.ttl"),
        documents_dir=tmp_path / "missing-documents",
        lancedb_uri=tmp_path / "lancedb",
        lancedb_table="ontology_entities_v1",
        embedding_backend="deterministic",
    )

    build_index(settings)

    rows = (
        lancedb.connect(settings.resolved_lancedb_uri)
        .open_table(settings.lancedb_table)
        .to_arrow()
        .to_pylist()
    )
    assert len(rows) == 11
    assert {row["content_type"] for row in rows} == {"ontology_entity"}
    assert all(len(row["text"].split("\n")) == 3 for row in rows)
    assert not settings.resolved_documents_dir.exists()
