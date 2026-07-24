"""Extract stable text fragments from non-3GPP public artifacts."""

from __future__ import annotations

import hashlib
from html.parser import HTMLParser
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from typing import Any, Mapping


EXTERNAL_EXTRACTOR_VERSION = "external-text-1.0.0"


class ExternalExtractionError(RuntimeError):
    """Raised when a downloaded public artifact cannot be converted to text."""


class _VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style", "noscript", "svg"}:
            self._hidden_depth += 1
        elif tag.lower() in {"p", "div", "section", "article", "li", "tr", "br", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript", "svg"} and self._hidden_depth:
            self._hidden_depth -= 1
        elif tag.lower() in {"p", "div", "section", "article", "li", "tr", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._hidden_depth:
            self.parts.append(data)


def _normalize(value: str) -> str:
    lines = [" ".join(line.split()) for line in value.replace("\r", "\n").split("\n")]
    return "\n".join(line for line in lines if line).strip()


def _html_text(path: Path) -> str:
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    parser = _VisibleTextParser()
    parser.feed(text)
    return _normalize("".join(parser.parts))


def _pdf_pages(path: Path) -> list[str]:
    executable = shutil.which("pdftotext")
    if not executable:
        raise ExternalExtractionError("pdftotext is required to extract a PDF evidence artifact")
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as handle:
        output = Path(handle.name)
    try:
        subprocess.run(
            [executable, "-layout", str(path), str(output)],
            check=True,
            capture_output=True,
            timeout=180,
        )
        text = output.read_text(encoding="utf-8", errors="replace")
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        raise ExternalExtractionError(f"Cannot extract PDF {path}: {exc}") from exc
    finally:
        output.unlink(missing_ok=True)
    return [_normalize(page) for page in text.split("\f") if _normalize(page)]


def extract_external_fragments(
    path: Path, provenance: Mapping[str, Any]
) -> list[dict[str, Any]]:
    """Extract one HTML/text fragment or page-addressed PDF fragments."""

    media_type = str(provenance.get("media_type") or "").lower()
    suffix = path.suffix.lower()
    if suffix == ".pdf" or "pdf" in media_type:
        units = [(f"page {index}", text) for index, text in enumerate(_pdf_pages(path), 1)]
        block_type = "pdf-page"
    elif suffix in {".html", ".htm"} or "html" in media_type:
        units = [("document", _html_text(path))]
        block_type = "html-document"
    elif suffix in {".txt", ".xml", ".json"} or media_type.startswith("text/"):
        units = [("document", _normalize(path.read_text(encoding="utf-8", errors="replace")))]
        block_type = "text-document"
    else:
        raise ExternalExtractionError(
            f"Unsupported external evidence artifact {path} ({media_type or 'unknown media type'})"
        )

    source_id = str(provenance.get("id") or "")
    source_hash = str(provenance.get("sha256") or "")
    fragments: list[dict[str, Any]] = []
    for ordinal, (locator, text) in enumerate(units, 1):
        if not text:
            continue
        content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        identity = f"{source_id}|{source_hash}|{locator}|{content_hash}"
        fragments.append(
            {
                "fragment_id": "external-" + hashlib.sha256(identity.encode("utf-8")).hexdigest(),
                "source_id": source_id,
                "source_number": provenance.get("standard_number") or provenance.get("number"),
                "source_version": provenance.get("version"),
                "source_sha256": source_hash,
                "official_url": provenance.get("official_url"),
                "artifact_url": provenance.get("artifact_url"),
                "locator": locator,
                "section_number": "",
                "section_title": "",
                "block_type": block_type,
                "block_index": ordinal,
                "text": text,
                "content_hash": content_hash,
                "normalized_text_sha256": content_hash,
                "extractor_version": EXTERNAL_EXTRACTOR_VERSION,
            }
        )
    return fragments


__all__ = [
    "EXTERNAL_EXTRACTOR_VERSION",
    "ExternalExtractionError",
    "extract_external_fragments",
]
