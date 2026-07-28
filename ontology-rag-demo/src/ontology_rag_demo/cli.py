from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from .embedding import build_embedder
from .ingestion import load_document_chunks
from .ontology import OntologyGraph
from .settings import Settings
from .vector_store import LanceDBVectorStore


def prepare(settings: Settings) -> None:
    source_ontology = settings.resolved_source_ontology_path
    if source_ontology is None:
        raise RuntimeError("No source ontology is configured")
    if not source_ontology.is_file():
        raise FileNotFoundError(f"Source ontology does not exist: {source_ontology}")

    document_sources = settings.resolved_source_document_paths
    if not document_sources:
        raise RuntimeError("No source documents are configured")
    missing = [path for path in document_sources if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Source documents do not exist: {missing}")

    ontology_target = settings.resolved_ontology_path
    documents_target = settings.resolved_documents_dir
    ontology_target.parent.mkdir(parents=True, exist_ok=True)
    documents_target.mkdir(parents=True, exist_ok=True)

    _copy_if_different(source_ontology, ontology_target)
    for source in document_sources:
        _copy_if_different(source, documents_target / source.name)

    print(f"Prepared ontology: {ontology_target}")
    print(f"Prepared documents: {len(document_sources)} file(s) in {documents_target}")


def build_index(settings: Settings) -> None:
    ontology = OntologyGraph.from_file(settings.resolved_ontology_path)
    document_chunks = load_document_chunks(
        settings.resolved_documents_dir,
        size=settings.chunk_size,
        overlap=settings.chunk_overlap,
    )
    chunks = [*ontology.entity_chunks(), *document_chunks]
    if not document_chunks:
        raise RuntimeError(
            f"No .txt documents found in {settings.resolved_documents_dir}; "
            "run `ontology-rag prepare` first"
        )

    embedder = build_embedder(settings)
    vectors = embedder.encode([chunk.text for chunk in chunks])
    store = LanceDBVectorStore(
        settings.resolved_lancedb_uri,
        settings.lancedb_table,
    )
    count = store.rebuild(chunks, vectors)
    print(
        f"Built {count} vectors ({embedder.dimension} dimensions): "
        f"{len(ontology.entity_chunks())} ontology entities + "
        f"{len(document_chunks)} document chunks"
    )


def smoke(settings: Settings) -> None:
    summary = settings.safe_summary()
    if settings.resolved_ontology_path.is_file():
        ontology = OntologyGraph.from_file(settings.resolved_ontology_path)
        summary["ontology_nodes"] = ontology.node_count
        summary["ontology_edges"] = ontology.edge_count
    store = LanceDBVectorStore(
        settings.resolved_lancedb_uri,
        settings.lancedb_table,
    )
    summary["vector_index_ready"] = store.exists()
    for key, value in summary.items():
        print(f"{key}: {value}")


def serve(settings: Settings) -> None:
    import uvicorn

    uvicorn.run(
        "ontology_rag_demo.api:app",
        host=settings.api_host,
        port=settings.api_port,
        workers=1,
        log_level=settings.log_level.lower(),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Ontology RAG demo")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("prepare", "build-index", "smoke", "serve"):
        subparsers.add_parser(command)
    args = parser.parse_args()
    settings = Settings()
    commands = {
        "prepare": prepare,
        "build-index": build_index,
        "smoke": smoke,
        "serve": serve,
    }
    commands[args.command](settings)


def _copy_if_different(source: Path, target: Path) -> None:
    if source.resolve() == target.resolve():
        return
    shutil.copy2(source, target)
