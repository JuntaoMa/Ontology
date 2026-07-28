from ontology_rag_demo.settings import Settings


def test_safe_summary_never_contains_sensitive_values(monkeypatch) -> None:
    monkeypatch.setenv("QWEN_BASE_URL", "https://internal.example.test/v1")
    monkeypatch.setenv("QWEN_API_KEY", "very-secret-token")
    monkeypatch.setenv("QWEN_MODEL", "internal-model")

    summary = Settings().safe_summary()
    serialized = repr(summary)

    assert summary["qwen_configured"] is True
    assert "internal.example" not in serialized
    assert "very-secret-token" not in serialized
    assert "internal-model" not in serialized


def test_default_sample_sources_are_committed(monkeypatch) -> None:
    monkeypatch.delenv("SOURCE_ONTOLOGY_PATH", raising=False)
    monkeypatch.delenv("SOURCE_DOCUMENT_PATHS", raising=False)

    settings = Settings()

    assert settings.resolved_source_ontology_path is not None
    assert settings.resolved_source_ontology_path.is_file()
    assert settings.resolved_source_document_paths
    assert all(path.is_file() for path in settings.resolved_source_document_paths)
