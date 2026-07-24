"""SQLite-backed lookup for large evidence-fragment corpora."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
import re
import sqlite3
import tempfile
from typing import Any, Mapping


INDEX_SCHEMA_VERSION = "2"


def _locator_sections(locator: str) -> tuple[str, ...]:
    """Return explicit clause/section/annex anchors from a citation locator."""

    anchors: list[str] = []
    patterns = (
        r"(?:clause|section|§)\s*([A-Za-z]?\d+(?:\.\d+)*|[A-Za-z](?:\.\d+)*)",
        r"annex\s+([A-Za-z](?:\.\d+)*)",
        r"(?:table|figure)\s+([A-Za-z]?\d+(?:\.\d+)*)",
    )
    for pattern in patterns:
        anchors.extend(match.upper() for match in re.findall(pattern, locator, re.I))
    if not anchors:
        plain = re.match(r"\s*([A-Za-z]?\d+(?:\.\d+)*)\b", locator)
        if plain:
            anchors.append(plain.group(1).upper())
    return tuple(dict.fromkeys(anchors))


def _section_matches(section: str, anchors: tuple[str, ...]) -> bool:
    normalized = section.strip().upper()
    return any(normalized == anchor or normalized.startswith(f"{anchor}.") for anchor in anchors)


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_fragment_index(jsonl_path: Path, index_path: Path) -> int:
    """Create an atomic query index from extracted fragment JSONL."""

    index_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=index_path.parent,
        prefix=f".{index_path.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
    temporary.unlink(missing_ok=True)
    connection = sqlite3.connect(temporary)
    count = 0
    try:
        connection.executescript(
            """
            PRAGMA journal_mode=OFF;
            PRAGMA synchronous=OFF;
            CREATE TABLE fragments (
                source_id TEXT NOT NULL,
                source_sha256 TEXT NOT NULL,
                fragment_id TEXT NOT NULL,
                locator TEXT,
                section_number TEXT,
                text TEXT NOT NULL,
                content_hash TEXT NOT NULL
            );
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """
        )
        batch: list[tuple[str, str, str, str, str, str, str]] = []
        source_hashes: dict[str, str] = {}
        with jsonl_path.open("r", encoding="utf-8") as input_handle:
            for line_number, line in enumerate(input_handle, 1):
                if not line.strip():
                    continue
                row = json.loads(line)
                source_id = str(row.get("source_id") or "")
                fragment_id = str(row.get("fragment_id") or "")
                source_sha256 = str(row.get("source_sha256") or "")
                content_hash = str(
                    row.get("content_hash")
                    or row.get("normalized_text_sha256")
                    or row.get("sha256")
                    or ""
                )
                if not source_id or not source_sha256 or not fragment_id or not content_hash:
                    raise ValueError(
                        f"Fragment JSONL row {line_number} lacks source_id, source_sha256, fragment_id, or content hash"
                    )
                computed_hash = hashlib.sha256(str(row.get("text") or "").encode("utf-8")).hexdigest()
                if computed_hash != content_hash:
                    raise ValueError(
                        f"Fragment JSONL row {line_number} content hash mismatch: "
                        f"expected {content_hash}, computed {computed_hash}"
                    )
                previous_hash = source_hashes.setdefault(source_id, source_sha256)
                if previous_hash != source_sha256:
                    raise ValueError(
                        f"Fragment JSONL mixes artifact hashes for {source_id}: "
                        f"{previous_hash} and {source_sha256}"
                    )
                batch.append(
                    (
                        source_id,
                        source_sha256,
                        fragment_id,
                        str(row.get("locator") or ""),
                        str(row.get("section_number") or row.get("clause") or ""),
                        str(row.get("text") or ""),
                        content_hash,
                    )
                )
                if len(batch) >= 2000:
                    connection.executemany(
                        "INSERT INTO fragments VALUES (?, ?, ?, ?, ?, ?, ?)", batch
                    )
                    count += len(batch)
                    batch.clear()
        if batch:
            connection.executemany("INSERT INTO fragments VALUES (?, ?, ?, ?, ?, ?, ?)", batch)
            count += len(batch)
        connection.execute("CREATE INDEX fragments_source_fragment ON fragments(source_id, fragment_id)")
        connection.execute("CREATE INDEX fragments_source_section ON fragments(source_id, section_number)")
        connection.execute("CREATE INDEX fragments_source_locator ON fragments(source_id, locator)")
        connection.execute(
            "INSERT INTO metadata(key, value) VALUES ('schema_version', ?)",
            (INDEX_SCHEMA_VERSION,),
        )
        connection.execute(
            "INSERT INTO metadata(key, value) VALUES ('fragment_count', ?)", (str(count),)
        )
        connection.execute(
            "INSERT INTO metadata(key, value) VALUES ('source_sha256_map', ?)",
            (json.dumps(source_hashes, sort_keys=True),),
        )
        connection.execute(
            "INSERT INTO metadata(key, value) VALUES ('input_jsonl_sha256', ?)",
            (_file_sha256(jsonl_path),),
        )
        connection.commit()
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    finally:
        connection.close()
    temporary.replace(index_path)
    return count


class FragmentIndex:
    def __init__(self, path: Path) -> None:
        self.connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        self.connection.row_factory = sqlite3.Row
        try:
            row = self.connection.execute(
                "SELECT value FROM metadata WHERE key = 'schema_version'"
            ).fetchone()
        except sqlite3.DatabaseError:
            self.connection.close()
            raise ValueError(f"Invalid fragment index: {path}") from None
        if row is None or str(row["value"]) != INDEX_SCHEMA_VERSION:
            self.connection.close()
            actual = str(row["value"]) if row is not None else "missing"
            raise ValueError(
                f"Fragment index schema {actual} is not supported; rebuild with schema {INDEX_SCHEMA_VERSION}"
            )
        hashes_row = self.connection.execute(
            "SELECT value FROM metadata WHERE key = 'source_sha256_map'"
        ).fetchone()
        if hashes_row is None:
            self.connection.close()
            raise ValueError("Fragment index has no source/artifact hash map")
        try:
            source_hashes = json.loads(str(hashes_row["value"]))
        except json.JSONDecodeError:
            self.connection.close()
            raise ValueError("Fragment index source/artifact hash map is invalid") from None
        if not isinstance(source_hashes, dict):
            self.connection.close()
            raise ValueError("Fragment index source/artifact hash map is invalid")
        self.source_hashes = {str(key): str(value) for key, value in source_hashes.items()}
        jsonl_row = self.connection.execute(
            "SELECT value FROM metadata WHERE key = 'input_jsonl_sha256'"
        ).fetchone()
        if jsonl_row is None or not re.fullmatch(r"[0-9a-f]{64}", str(jsonl_row["value"])):
            self.connection.close()
            raise ValueError("Fragment index has no valid input JSONL hash")
        self.input_jsonl_sha256 = str(jsonl_row["value"])
        self.cache: dict[tuple[str, str, str, str, str, bool], dict[str, Any] | None] = {}

    def verify_jsonl(self, path: Path) -> None:
        if not path.is_file() or _file_sha256(path) != self.input_jsonl_sha256:
            raise ValueError("Fragment JSONL and SQLite index are out of sync; rebuild the index")

    def close(self) -> None:
        self.connection.close()

    def find(self, evidence: Mapping[str, Any]) -> dict[str, Any] | None:
        source_id = str(evidence.get("source") or "")
        locator = str(evidence.get("locator") or "").strip()
        # Exact quoted text is the authoritative selector when present; a
        # separate semantic match hint must never override it.
        quote = str(evidence.get("quote") or "").strip()
        match_hint = str(evidence.get("match") or "").strip()
        match = str(quote or match_hint).strip()
        fragment_id = str(evidence.get("fragment_id") or "")
        require_locator_match = bool(evidence.get("_require_locator_match"))
        key = (source_id, locator, quote, match_hint, fragment_id, require_locator_match)
        if key in self.cache:
            return self.cache[key]

        if fragment_id:
            rows = self.connection.execute(
                "SELECT * FROM fragments WHERE source_id = ? AND fragment_id = ?",
                (source_id, fragment_id),
            ).fetchall()
        elif quote:
            # External extractors may be page- or document-addressed rather
            # than clause-addressed. The exact quote itself is a stronger span
            # selector; the human-readable clause remains provenance metadata.
            rows = self.connection.execute(
                "SELECT * FROM fragments WHERE source_id = ?", (source_id,)
            ).fetchall()
        else:
            locator_sections = _locator_sections(locator)
            if locator_sections:
                clauses = " OR ".join("section_number = ? OR section_number LIKE ?" for _ in locator_sections)
                parameters: list[str] = [source_id]
                for section in locator_sections:
                    parameters.extend((section, f"{section}.%"))
                parameters.append(locator)
                rows = self.connection.execute(
                    f"""
                    SELECT * FROM fragments
                    WHERE source_id = ? AND (
                        {clauses} OR locator = ?
                    )
                    """,
                    parameters,
                ).fetchall()
            else:
                rows = self.connection.execute(
                    "SELECT * FROM fragments WHERE source_id = ? AND locator = ?",
                    (source_id, locator),
                ).fetchall()
        locator_sections = _locator_sections(locator)
        if require_locator_match:
            normalized_locator = " ".join(locator.split()).casefold()
            explicit_fragment_locator = bool(
                fragment_id and normalized_locator == f"fragment:{fragment_id}".casefold()
            )
            if explicit_fragment_locator:
                pass
            elif locator_sections:
                rows = [
                    row
                    for row in rows
                    if (
                        str(row["section_number"]).strip()
                        and _section_matches(str(row["section_number"]), locator_sections)
                    )
                    or " ".join(str(row["locator"]).split()).casefold()
                    == normalized_locator
                ]
            else:
                rows = [
                    row
                    for row in rows
                    if " ".join(str(row["locator"]).split()).casefold()
                    == normalized_locator
                ]
        elif locator_sections:
            rows = [
                row
                for row in rows
                if not str(row["section_number"]).strip()
                or _section_matches(str(row["section_number"]), locator_sections)
            ]

        if match:
            normalized_match = " ".join(match.split())
            if quote:
                matched = [
                    row
                    for row in rows
                    if normalized_match in " ".join(str(row["text"]).split())
                ]
            else:
                folded_match = normalized_match.casefold()
                matched = [
                    row
                    for row in rows
                    if folded_match
                    in " ".join(str(row["text"]).split()).casefold()
                ]
            # A supplied match is an integrity constraint, not a ranking hint.
            # Falling back to an unrelated fragment would create a plausible-
            # looking but false provenance edge.
            rows = matched
        selected = min(rows, key=lambda row: len(str(row["text"])), default=None)
        result = dict(selected) if selected is not None else None
        if result is not None:
            result["normalized_text_sha256"] = result["content_hash"]
        self.cache[key] = result
        return result


__all__ = [
    "FragmentIndex",
    "INDEX_SCHEMA_VERSION",
    "build_fragment_index",
]
