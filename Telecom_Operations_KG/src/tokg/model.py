"""Shared data model and deterministic identifier helpers."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote

from rdflib import Literal, Namespace, URIRef
from rdflib.namespace import RDF, XSD


ONTOLOGY_BASE = "https://example.org/tokg/ontology#"
IDENTIFIER_BASE = "https://example.org/tokg/id/"
GRAPH_BASE = "https://example.org/tokg/graph/"

TOKG = Namespace(ONTOLOGY_BASE)
TOKG_ID = Namespace(IDENTIFIER_BASE)
TOKG_GRAPH = Namespace(GRAPH_BASE)


class CatalogError(ValueError):
    """Raised when a catalog record is structurally invalid."""


def catalog_source_ids(project_root: Path) -> set[str]:
    """Return source IDs used by evidence records in the current catalogs."""

    result: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            if isinstance(value.get("source"), str) and value.get("locator"):
                result.add(value["source"])
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    for path in sorted((project_root / "catalog").glob("*.json")):
        visit(json.loads(path.read_text(encoding="utf-8")))
    return result


def build_input_paths(project_root: Path) -> list[Path]:
    """Return the complete, deterministic inventory of build-affecting inputs."""

    paths = (
        [
            project_root / "config" / "standards.json",
            project_root / "sources" / "lock.json",
            project_root / "shapes" / "tokg-shapes.ttl",
            project_root / "pyproject.toml",
            project_root / "uv.lock",
            project_root / "evidence" / "fragments.sqlite",
            project_root / "evidence" / "fragments.jsonl",
        ]
        + list((project_root / "ontology").glob("*.ttl"))
        + list((project_root / "catalog").glob("*.json"))
        + list((project_root / "src" / "tokg").glob("*.py"))
    )
    lock_path = project_root / "sources" / "lock.json"
    if lock_path.exists():
        cited = catalog_source_ids(project_root)
        payload = json.loads(lock_path.read_text(encoding="utf-8"))
        for source in payload.get("sources", []):
            local_path = source.get("zip_path") or source.get("artifact_path")
            if source.get("id") in cited and source.get("sha256") and local_path:
                candidate = Path(local_path)
                paths.append(candidate if candidate.is_absolute() else project_root / candidate)
    return sorted(dict.fromkeys(paths))


def canonical_json(value: Any) -> str:
    """Return a stable JSON representation used as hash input."""

    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def concept_iri(local_id: str) -> URIRef:
    if not local_id or local_id.startswith(("http://", "https://", "urn:")):
        if local_id:
            return URIRef(local_id)
        raise CatalogError("Concept ID must not be empty")
    safe = "/".join(quote(part, safe="-._~:@") for part in local_id.split("/"))
    return URIRef(f"{IDENTIFIER_BASE}{safe}")


def term_iri(local_name: str) -> URIRef:
    if local_name.startswith(("http://", "https://", "urn:")):
        return URIRef(local_name)
    return TOKG[local_name]


def datatype_iri(name: str | None) -> URIRef | None:
    if not name:
        return None
    if name.startswith("xsd:"):
        return XSD[name.split(":", 1)[1]]
    return URIRef(name)


def object_term(record: dict[str, Any]) -> URIRef | Literal:
    """Convert the object part of a catalog assertion into an RDF term."""

    choices = [key for key in ("object", "literal") if key in record]
    if len(choices) != 1:
        raise CatalogError("Relation must contain exactly one of 'object' or 'literal'")
    if "object" in record:
        return concept_iri(str(record["object"]))
    value = record["literal"]
    if isinstance(value, dict):
        lexical = value.get("value")
        if lexical is None:
            raise CatalogError("Literal object is missing 'value'")
        language = value.get("lang")
        datatype = datatype_iri(value.get("datatype"))
        if language and datatype:
            raise CatalogError("A literal cannot have both language and datatype")
        return Literal(lexical, lang=language, datatype=datatype)
    return Literal(value)


def assertion_digest(
    subject: URIRef,
    predicate: URIRef,
    obj: URIRef | Literal,
    *,
    polarity: str = "positive",
    modality: str = "asserted",
    scope: Iterable[str] = (),
    status: str = "reviewed",
    confidence: float = 1.0,
    derived_from: Iterable[str] = (),
    derivation_rule: str = "",
) -> str:
    if isinstance(obj, URIRef):
        object_payload: dict[str, Any] = {"kind": "iri", "value": str(obj)}
    else:
        object_payload = {
            "kind": "literal",
            "value": str(obj),
            "datatype": str(obj.datatype) if obj.datatype else None,
            "lang": obj.language,
        }
    payload = {
        "subject": str(subject),
        "predicate": str(predicate),
        "object": object_payload,
        "polarity": polarity,
        "modality": modality,
        "scope": sorted(scope),
        "status": status,
        "confidence": confidence,
        "derived_from": sorted(derived_from),
        "derivation_rule": derivation_rule,
    }
    return sha256_text(canonical_json(payload))


def evidence_digest(
    source_id: str,
    locator: str,
    fragment_hash: str = "",
    exact_text_hash: str = "",
    artifact_hash: str = "",
    fragment_id: str = "",
    reported_locator: str = "",
) -> str:
    return sha256_text(
        canonical_json(
            {
                "source_id": source_id,
                "locator": locator,
                "fragment_hash": fragment_hash,
                "exact_text_hash": exact_text_hash,
                "artifact_hash": artifact_hash,
                "fragment_id": fragment_id,
                "reported_locator": reported_locator,
            }
        )
    )


@dataclass(frozen=True)
class SourceRecord:
    id: str
    organization: str
    number: str
    title: str
    document_type: str
    version: str | None
    release: str | int | None
    official_url: str
    artifact_url: str | None
    sha256: str | None
    retrieved_at: str | None
    language: str
    lifecycle_status: str
    normative_status: str
    local_path: str | None
    media_type: str | None
    byte_size: int | None
    raw: dict[str, Any]

    @property
    def family_iri(self) -> URIRef:
        return concept_iri(f"document/{self.organization.lower()}/{self.number.lower()}")

    @property
    def edition_iri(self) -> URIRef:
        edition = self.version or str(self.release or "unversioned")
        return concept_iri(
            f"edition/{self.organization.lower()}/{self.number.lower()}/{edition.lower()}"
        )

    @property
    def artifact_iri(self) -> URIRef:
        if not self.sha256:
            raise CatalogError(
                f"Source {self.id} has no verified artifact SHA-256; fetch it before citing it"
            )
        key = self.sha256
        return concept_iri(f"artifact/sha256/{key}")


def load_sources(project_root: Path) -> dict[str, SourceRecord]:
    lock_path = project_root / "sources" / "lock.json"
    config_path = project_root / "config" / "standards.json"
    path = lock_path if lock_path.exists() else config_path
    if not path.exists():
        raise CatalogError("Neither sources/lock.json nor config/standards.json exists")
    payload = json.loads(path.read_text(encoding="utf-8"))
    output: dict[str, SourceRecord] = {}
    for item in payload.get("sources", []):
        source_id = item["id"]
        if source_id in output:
            raise CatalogError(f"Duplicate source ID: {source_id}")
        landing_url = (
            item.get("metadata_url")
            or item.get("official_url")
            or item.get("url")
            or item.get("archive_directory_url")
        )
        if not landing_url:
            raise CatalogError(f"Source {source_id} has no official URL")
        artifact_url = item.get("artifact_url") or item.get("download_url")
        if not artifact_url and item.get("filename"):
            artifact_url = item.get("official_url")
        if not artifact_url and item.get("sha256"):
            artifact_url = item.get("official_url") or item.get("url")
        local_path = item.get("zip_path") or item.get("artifact_path")
        byte_size = item.get("byte_size")
        if byte_size is None and local_path:
            candidate = project_root / local_path if not Path(local_path).is_absolute() else Path(local_path)
            if candidate.exists():
                byte_size = candidate.stat().st_size
        media_type = item.get("media_type")
        if not media_type and item.get("zip_path"):
            media_type = "application/zip"
        output[source_id] = SourceRecord(
            id=source_id,
            organization=item["organization"],
            number=item.get("number") or item.get("standard", ""),
            title=item.get("title", ""),
            document_type=item.get("document_type", "Standard"),
            version=item.get("version") or item.get("resolved_version"),
            release=item.get("release"),
            official_url=landing_url,
            artifact_url=artifact_url,
            sha256=item.get("sha256"),
            retrieved_at=item.get("retrieved_at") or payload.get("retrieved_at"),
            language=item.get("language", "en"),
            lifecycle_status=item.get("lifecycle_status", "in-force"),
            normative_status=item.get("normative_status", "normative"),
            local_path=local_path,
            media_type=media_type,
            byte_size=byte_size,
            raw=item,
        )
    return output


def load_catalogs(project_root: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in sorted((project_root / "catalog").glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise CatalogError(f"Catalog root must be an object: {path}")
        payload["_path"] = str(path)
        records.append(payload)
    if not records:
        raise CatalogError("No catalog JSON files found")
    return records
