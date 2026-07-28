from pathlib import Path

from ontology_rag_demo.cli import prepare
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
