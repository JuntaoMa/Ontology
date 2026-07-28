from ontology_rag_demo.ingestion import chunk_text


def test_chunk_text_is_bounded_and_overlapping() -> None:
    chunks = chunk_text("a" * 150 + "\n\n" + "b" * 150, size=200, overlap=20)

    assert len(chunks) == 2
    assert all(len(chunk) <= 200 for chunk in chunks)
