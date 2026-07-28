from __future__ import annotations

from functools import cached_property
from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Runtime settings loaded only from process environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="",
        case_sensitive=False,
        extra="ignore",
    )

    qwen_base_url: str | None = None
    qwen_api_key: SecretStr | None = None
    qwen_model: str | None = None
    qwen_timeout_seconds: float = 120.0

    source_ontology_path: Path | None = Path("examples/smart-building/ontology.ttl")
    source_document_paths: str = "examples/smart-building/documents/operations-guide.txt"

    ontology_path: Path = Path("data/source/smart-building/ontology.ttl")
    documents_dir: Path = Path("data/source/smart-building/documents")
    lancedb_uri: Path = Path("state/smart-building/lancedb")
    lancedb_table: str = "ontology_chunks_v1"

    embedding_backend: Literal["bge-m3", "deterministic"] = "deterministic"
    embedding_model: str = "BAAI/bge-m3"
    embedding_device: Literal["cpu", "mps"] = "cpu"
    embedding_batch_size: int = 2
    embedding_max_length: int = 512
    embedding_normalize: bool = True

    vector_top_k: int = 5
    chunk_size: int = 1200
    chunk_overlap: int = 150
    graph_max_anchors: int = 6
    graph_max_nodes: int = 80

    api_host: str = "127.0.0.1"
    api_port: int = 8010
    log_level: str = "INFO"

    @field_validator("qwen_base_url", "qwen_model", mode="before")
    @classmethod
    def blank_string_is_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("qwen_api_key", mode="before")
    @classmethod
    def blank_secret_is_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator(
        "embedding_batch_size",
        "embedding_max_length",
        "vector_top_k",
        "chunk_size",
        "graph_max_anchors",
        "graph_max_nodes",
    )
    @classmethod
    def positive_integer(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("value must be positive")
        return value

    @field_validator("chunk_overlap")
    @classmethod
    def non_negative_overlap(cls, value: int) -> int:
        if value < 0:
            raise ValueError("chunk_overlap must be non-negative")
        return value

    @cached_property
    def resolved_ontology_path(self) -> Path:
        return self._resolve(self.ontology_path)

    @cached_property
    def resolved_documents_dir(self) -> Path:
        return self._resolve(self.documents_dir)

    @cached_property
    def resolved_lancedb_uri(self) -> Path:
        return self._resolve(self.lancedb_uri)

    @cached_property
    def resolved_source_ontology_path(self) -> Path | None:
        if self.source_ontology_path is None:
            return None
        return self._resolve(self.source_ontology_path)

    @cached_property
    def resolved_source_document_paths(self) -> tuple[Path, ...]:
        paths = []
        for raw_path in self.source_document_paths.split(","):
            raw_path = raw_path.strip()
            if raw_path:
                paths.append(self._resolve(Path(raw_path)))
        return tuple(paths)

    def require_qwen(self) -> tuple[str, str, str]:
        api_key = self.qwen_api_key.get_secret_value() if self.qwen_api_key else ""
        if not self.qwen_base_url or not api_key or not self.qwen_model:
            raise RuntimeError(
                "QWEN_BASE_URL, QWEN_API_KEY and QWEN_MODEL must be provided "
                "through environment variables before calling /v1/answer"
            )
        return self.qwen_base_url.rstrip("/"), api_key, self.qwen_model

    def safe_summary(self) -> dict[str, object]:
        """Return diagnostics without exposing internal addresses, names, or secrets."""

        return {
            "qwen_configured": bool(self.qwen_base_url and self.qwen_api_key and self.qwen_model),
            "embedding_backend": self.embedding_backend,
            "embedding_device": self.embedding_device,
            "ontology_ready": self.resolved_ontology_path.is_file(),
            "documents_ready": self.resolved_documents_dir.is_dir(),
            "lancedb_ready": self.resolved_lancedb_uri.is_dir(),
        }

    @staticmethod
    def _resolve(path: Path) -> Path:
        if path.is_absolute():
            return path.resolve()
        return (PROJECT_ROOT / path).resolve()
