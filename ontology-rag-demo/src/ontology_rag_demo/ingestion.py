from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Chunk:
    id: str
    text: str
    source: str
    chunk_index: int
    content_type: str = "document"


def chunk_text(text: str, *, size: int, overlap: int) -> list[str]:
    if overlap >= size:
        raise ValueError("chunk_overlap must be smaller than chunk_size")

    normalized = re.sub(r"\r\n?", "\n", text).strip()
    chunks: list[str] = []
    start = 0

    while start < len(normalized):
        hard_end = min(start + size, len(normalized))
        end = hard_end
        if hard_end < len(normalized):
            search_from = start + size // 2
            candidates = [
                normalized.rfind("\n\n", search_from, hard_end),
                normalized.rfind("\n", search_from, hard_end),
                normalized.rfind("。", search_from, hard_end),
                normalized.rfind(". ", search_from, hard_end),
            ]
            boundary = max(candidates)
            if boundary > start:
                end = boundary + 1

        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(end - overlap, start + 1)

    return chunks


def load_document_chunks(
    documents_dir: Path,
    *,
    size: int,
    overlap: int,
) -> list[Chunk]:
    chunks: list[Chunk] = []
    for path in sorted(documents_dir.rglob("*.txt")):
        text = path.read_text(encoding="utf-8", errors="replace")
        relative_source = path.relative_to(documents_dir).as_posix()
        for index, content in enumerate(chunk_text(text, size=size, overlap=overlap)):
            digest = hashlib.sha256(f"{relative_source}\0{index}\0{content}".encode()).hexdigest()
            chunks.append(
                Chunk(
                    id=digest,
                    text=content,
                    source=relative_source,
                    chunk_index=index,
                )
            )
    return chunks
