"""Resolve, lock, download, and extract public standards sources.

The pipeline is intentionally small and reproducible:

* 3GPP versions are selected from the official archive directory by the
  configured release code, unless a filename is explicitly pinned.
* every downloaded ZIP is content-addressed with SHA-256 and checked against
  any configured or previously locked digest;
* DOCX payloads are extracted without third-party libraries and converted to
  evidence JSONL by :mod:`tokg.docx_extract`.

An existing lock is authoritative unless ``--refresh`` is requested.  This is
what lets the same command run without network access after the first download.
"""

from __future__ import annotations

import argparse
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
import hashlib
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import Request, urlopen
import zipfile
from concurrent.futures import ThreadPoolExecutor

from .docx_extract import (
    EXTRACTOR_VERSION,
    DocxExtractionError,
    extract_fragments,
    write_fragments_jsonl,
)
from .external_extract import ExternalExtractionError, extract_external_fragments
from .fragment_index import build_fragment_index


LOCK_SCHEMA_VERSION = "1.0"
USER_AGENT = "Telecom-Operations-KG/0.1 (+public-standards-evidence-sync)"
DEFAULT_TIMEOUT_SECONDS = 45.0


class SourceSyncError(RuntimeError):
    """A configuration, resolution, download, or extraction failure."""


class _HrefParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        for name, value in attrs:
            if name.lower() == "href" and value:
                self.hrefs.append(value)


@dataclass(frozen=True)
class PipelinePaths:
    root: Path
    config: Path
    lock: Path
    downloads: Path
    extracted: Path
    fragments: Path


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _read_json(path: Path, description: str) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError as exc:
        raise SourceSyncError(f"{description} does not exist: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SourceSyncError(
            f"{description} is not valid JSON at line {exc.lineno}, column {exc.colno}: {path}"
        ) from exc
    except OSError as exc:
        raise SourceSyncError(f"Cannot read {description} {path}: {exc}") from exc


def load_standards_config(path: str | Path) -> dict[str, Any]:
    """Load and minimally validate ``config/standards.json``."""

    config_path = Path(path)
    payload = _read_json(config_path, "Standards configuration")
    if not isinstance(payload, dict):
        raise SourceSyncError(f"Standards configuration must be a JSON object: {config_path}")
    sources = payload.get("sources")
    if not isinstance(sources, list) or not sources:
        raise SourceSyncError(
            f"Standards configuration must contain a non-empty 'sources' array: {config_path}"
        )
    baseline = payload.get("baseline", {})
    if baseline is not None and not isinstance(baseline, dict):
        raise SourceSyncError("Standards configuration field 'baseline' must be an object")

    seen_ids: set[str] = set()
    for index, source in enumerate(sources):
        if not isinstance(source, dict):
            raise SourceSyncError(f"sources[{index}] must be an object")
        source_id = source.get("id")
        if not isinstance(source_id, str) or not source_id.strip():
            raise SourceSyncError(f"sources[{index}] must have a non-empty string 'id'")
        if source_id in seen_ids:
            raise SourceSyncError(f"Duplicate source id in standards configuration: {source_id}")
        seen_ids.add(source_id)
        if not source.get("organization"):
            raise SourceSyncError(f"Source {source_id!r} is missing 'organization'")
        if not (source.get("number") or source.get("standard_number")):
            raise SourceSyncError(f"Source {source_id!r} is missing 'number'")
    resolution_ids = payload.get("artifact_resolution_source_ids", [])
    if not isinstance(resolution_ids, list) or not all(
        isinstance(value, str) for value in resolution_ids
    ):
        raise SourceSyncError("artifact_resolution_source_ids must be an array of source IDs")
    unknown_resolution_ids = sorted(set(resolution_ids) - seen_ids)
    if unknown_resolution_ids:
        raise SourceSyncError(
            f"artifact_resolution_source_ids contains unknown IDs: {unknown_resolution_ids}"
        )
    return payload


def load_lock(path: str | Path) -> dict[str, Any] | None:
    lock_path = Path(path)
    if not lock_path.exists():
        return None
    payload = _read_json(lock_path, "Source lock")
    if not isinstance(payload, dict) or not isinstance(payload.get("sources"), list):
        raise SourceSyncError(f"Source lock must contain a 'sources' array: {lock_path}")
    return payload


def _atomic_write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        newline="\n",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
        try:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    temporary.replace(path)


def _first(source: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        value = source.get(key)
        if value is not None and value != "":
            return value
    return None


def _organization(source: Mapping[str, Any]) -> str:
    return str(source.get("organization", "")).strip()


def _is_3gpp(source: Mapping[str, Any]) -> bool:
    return _organization(source).upper().replace(" ", "") == "3GPP"


def _is_itu(source: Mapping[str, Any]) -> bool:
    return _organization(source).upper().replace(" ", "") in {"ITU", "ITU-T"}


def _normal_sha256(value: Any, *, field: str, source_id: str) -> str | None:
    if value is None or value == "":
        return None
    digest = str(value).strip().lower()
    if digest.startswith("sha256:"):
        digest = digest[7:]
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise SourceSyncError(
            f"Source {source_id!r} has invalid {field}; expected a 64-character SHA-256 hex digest"
        )
    return digest


def _release_code(value: Any) -> str | None:
    if value is None or value == "":
        return None
    code = str(value).strip().lower()
    if code.startswith("rel-"):
        code = code[4:]
    if len(code) != 1 or code not in "0123456789abcdefghijklmnopqrstuvwxyz":
        raise SourceSyncError(f"Invalid 3GPP release_code {value!r}; expected one base-36 character")
    return code


def _release_number_from_code(code: str) -> int | None:
    if code.isdigit():
        return int(code)
    value = ord(code) - ord("a") + 10
    return value if value >= 10 else None


def _release_number(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, int):
        return value
    match = re.search(r"\d+", str(value))
    return int(match.group()) if match else None


def _compact_3gpp_number(source: Mapping[str, Any]) -> tuple[str, str, str]:
    number = str(_first(source, "number", "standard_number") or "").strip()
    document_type = str(source.get("document_type", "")).strip()
    match = re.fullmatch(
        r"(?:(?:TS|TR)\s*)?(\d{2})[.\s-]?(\d{3})(-\d{1,2})?",
        number,
        re.IGNORECASE,
    )
    if not match:
        source_id = source.get("id", "<unknown>")
        raise SourceSyncError(
            f"3GPP source {source_id!r} has unsupported number {number!r}; "
            "expected e.g. '23.501' or '32.111-1'"
        )
    series, suffix, part = match.groups()
    part = part or ""
    if not document_type:
        document_type = "TS"
    return f"{series}{suffix}{part}", series, f"{series}.{suffix}{part}"


def _default_3gpp_archive(source: Mapping[str, Any]) -> str:
    _, derived_series, dotted = _compact_3gpp_number(source)
    series = str(source.get("series") or derived_series).strip()
    return f"https://www.3gpp.org/ftp/Specs/archive/{series}_series/{dotted}/"


def _fetch_text(url: str, timeout: float) -> str:
    # The official 3GPP archive intermittently returns 403/TLS errors to
    # Python's default HTTP stack while the same public URL succeeds through
    # curl.  Prefer curl, cap the entire transfer, then retain urllib as a
    # portable fallback for environments where curl is unavailable.
    curl_error: Exception | None = None
    try:
        completed = subprocess.run(
            [
                "/usr/bin/curl",
                "-L",
                "--http1.1",
                "-f",
                "-sS",
                "--retry",
                "2",
                "--retry-all-errors",
                "--connect-timeout",
                str(max(1, min(10, int(timeout)))),
                "--max-time",
                str(max(2, int(timeout))),
                "-A",
                USER_AGENT,
                url,
            ],
            check=True,
            capture_output=True,
            timeout=max(timeout + 5, 10),
        )
        payload = completed.stdout
        charset = "utf-8"
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        curl_error = exc
        request = Request(
            url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.8"}
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                payload = response.read()
                charset = response.headers.get_content_charset() or "utf-8"
        except (HTTPError, URLError, TimeoutError, OSError) as urllib_error:
            raise SourceSyncError(
                f"Cannot read official archive directory {url}: curl={curl_error}; "
                f"urllib={urllib_error}"
            ) from urllib_error
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def _archive_links(html: str) -> list[str]:
    parser = _HrefParser()
    parser.feed(html)
    links = parser.hrefs
    if not links:
        # Some mirrors expose a plain-text index rather than valid HTML.
        links = re.findall(r"[^\s\"'<>]+\.zip(?:\?[^\s\"'<>]*)?", html, re.IGNORECASE)
    return links


def _base36_sort_key(value: str) -> tuple[int, ...]:
    return tuple(int(character, 36) for character in value.lower())


def _version_from_filename(
    filename: str, compact_number: str, release: Any, release_code: str | None
) -> str:
    pattern = re.compile(
        rf"^{re.escape(compact_number)}-(?P<code>[0-9a-z])(?P<minor>[0-9a-z])(?P<patch>[0-9a-z])\.zip$",
        re.IGNORECASE,
    )
    match = pattern.match(filename)
    if not match:
        raise SourceSyncError(
            f"Cannot derive 3GPP version from filename {filename!r}; expected {compact_number}-XYZ.zip"
        )
    code = match.group("code").lower()
    if release_code and code != release_code:
        raise SourceSyncError(
            f"Pinned filename {filename!r} belongs to release code {code!r}, not {release_code!r}"
        )
    major = _release_number(release) or _release_number_from_code(code)
    if major is None:
        raise SourceSyncError(f"Cannot derive release number from filename {filename!r}")
    minor = int(match.group("minor"), 36)
    patch = int(match.group("patch"), 36)
    return f"{major}.{minor}.{patch}"


def _safe_filename(value: str, source_id: str) -> str:
    decoded = unquote(value).strip()
    if not decoded or decoded in {".", ".."}:
        raise SourceSyncError(f"Source {source_id!r} has an empty or unsafe filename")
    if "\\" in decoded:
        raise SourceSyncError(f"Source {source_id!r} has unsafe filename {value!r}")
    path = PurePosixPath(decoded)
    if path.is_absolute() or ".." in path.parts or len(path.parts) != 1:
        raise SourceSyncError(f"Source {source_id!r} has unsafe filename {value!r}")
    return decoded


def _filename_from_url(url: str, source_id: str) -> str | None:
    basename = PurePosixPath(unquote(urlsplit(url).path)).name
    return _safe_filename(basename, source_id) if basename else None


def _resolve_latest_3gpp(
    source: Mapping[str, Any], archive_url: str, release_code: str, timeout: float
) -> tuple[str, str]:
    compact, _, _ = _compact_3gpp_number(source)
    html = _fetch_text(archive_url, timeout)
    pattern = re.compile(
        rf"^{re.escape(compact)}-{re.escape(release_code)}(?P<tail>[0-9a-z]{{2}})\.zip$",
        re.IGNORECASE,
    )
    candidates: list[tuple[tuple[int, ...], str, str]] = []
    for href in _archive_links(html):
        filename = PurePosixPath(unquote(urlsplit(href).path)).name
        match = pattern.match(filename)
        if not match:
            continue
        candidates.append((_base36_sort_key(match.group("tail")), filename, href))
    if not candidates:
        raise SourceSyncError(
            f"No {compact}-{release_code}XX.zip files found in official archive {archive_url}"
        )
    _, filename, href = max(candidates, key=lambda item: (item[0], item[1].lower()))
    return _safe_filename(filename, str(source.get("id"))), urljoin(archive_url, href)


_LOCK_RESOLUTION_FIELDS = (
    "filename",
    "version",
    "release",
    "release_code",
    "archive_url",
    "official_url",
    "artifact_url",
    "download_url",
    "retrieved_at",
    "sha256",
    "zip_path",
    "artifact_path",
    "byte_size",
    "media_type",
    "docx_paths",
    "edition_identifier",
    "fetch_artifact",
    "extractor_version",
    "status",
)


def _lock_matches_source(
    source: Mapping[str, Any], locked: Mapping[str, Any], baseline: Mapping[str, Any]
) -> bool:
    if source.get("id") != locked.get("id"):
        return False
    if _organization(source).casefold() != str(locked.get("organization", "")).casefold():
        return False
    number = str(_first(source, "number", "standard_number") or "")
    locked_number = str(_first(locked, "number", "standard_number") or "")
    if number != locked_number:
        return False
    if bool(source.get("extract", True)) != bool(locked.get("extract", True)):
        return False
    if source.get("resolve_artifact") and not (
        locked.get("version")
        and (locked.get("artifact_url") or locked.get("download_url"))
        and locked.get("filename")
    ):
        return False

    pinned_filename = _first(source, "filename", "pinned_filename")
    if pinned_filename and str(pinned_filename) != str(locked.get("filename", "")):
        return False
    configured_version = _first(source, "version", "edition")
    if configured_version and str(configured_version) != str(locked.get("version", "")):
        return False
    configured_url = _first(source, "download_url", "url")
    if configured_url and str(configured_url) != str(locked.get("official_url", "")):
        return False
    configured_archive = _first(source, "archive_directory_url", "archive_url")
    if configured_archive and str(configured_archive) != str(locked.get("archive_url", "")):
        return False
    configured_release = _first(source, "release")
    if configured_release is None and _is_3gpp(source):
        configured_release = baseline.get("3gpp_release")
    if configured_release is not None and _release_number(configured_release) != _release_number(
        locked.get("release")
    ):
        return False
    configured_code = _first(source, "release_code")
    if configured_code is None and _is_3gpp(source):
        configured_code = baseline.get("release_code")
    if configured_code is not None and _release_code(configured_code) != _release_code(
        locked.get("release_code")
    ):
        return False

    configured_sha = _normal_sha256(
        source.get("sha256"), field="sha256", source_id=str(source.get("id"))
    )
    if configured_sha and configured_sha != _normal_sha256(
        locked.get("sha256"), field="locked sha256", source_id=str(source.get("id"))
    ):
        return False
    return True


def _merge_locked_resolution(
    source: Mapping[str, Any], locked: Mapping[str, Any]
) -> dict[str, Any]:
    result = deepcopy(dict(source))
    for field in _LOCK_RESOLUTION_FIELDS:
        if field in locked:
            result[field] = deepcopy(locked[field])
    result["standard_number"] = _first(source, "number", "standard_number")
    if _organization(source).upper() == "IETF" and not result.get("version"):
        result["version"] = result["standard_number"]
    result["extractor_version"] = EXTRACTOR_VERSION
    return result


def _resolve_metadata_only(source: Mapping[str, Any], config_retrieved_at: Any) -> dict[str, Any]:
    result = deepcopy(dict(source))
    source_id = str(source["id"])
    official_url = _first(source, "download_url", "official_url", "url", "metadata_url")
    filename = _first(source, "filename", "pinned_filename")
    if not filename and official_url:
        filename = _filename_from_url(str(official_url), source_id)
    if filename:
        filename = _safe_filename(str(filename), source_id)
    result.update(
        {
            "standard_number": _first(source, "number", "standard_number"),
            "version": (
                _first(source, "version", "edition")
                or (_first(source, "number", "standard_number") if _organization(source).upper() == "IETF" else None)
            ),
            "release": source.get("release"),
            "archive_url": _first(source, "archive_directory_url", "archive_url"),
            "official_url": official_url,
            "filename": filename,
            "retrieved_at": source.get("retrieved_at") or config_retrieved_at or _utc_now(),
            "sha256": _normal_sha256(
                source.get("sha256"), field="sha256", source_id=source_id
            ),
            "extractor_version": EXTRACTOR_VERSION,
            "status": "metadata-only",
        }
    )
    return result


def _resolve_itu_artifact(
    source: Mapping[str, Any], config_retrieved_at: Any, timeout: float
) -> dict[str, Any]:
    """Resolve the latest base edition and public PDF for an ITU-T Recommendation."""

    source_id = str(source["id"])
    landing_url = str(
        _first(source, "metadata_url", "official_url", "url") or ""
    )
    if not landing_url:
        raise SourceSyncError(f"ITU-T source {source_id!r} has no recommendation landing URL")
    html = _fetch_text(landing_url, timeout)
    recommendation_ids = {
        unquote(value).replace("&amp;", "&")
        for value in re.findall(
            r"parent=(T-REC-[A-Z][A-Z0-9.]*-\d{6}-I)(?=[\"'&<])",
            html,
            re.IGNORECASE,
        )
    }
    if not recommendation_ids:
        raise SourceSyncError(
            f"No published base-edition identifier was found on ITU-T page {landing_url}"
        )
    recommendation_id = max(
        recommendation_ids,
        key=lambda value: (re.search(r"-(\d{6})-I$", value).group(1), value),
    )
    date_code = re.search(r"-(\d{4})(\d{2})-I$", recommendation_id)
    if not date_code:
        raise SourceSyncError(f"Cannot derive ITU-T edition from {recommendation_id}")
    version = f"{date_code.group(1)}-{date_code.group(2)}"
    artifact_url = (
        "https://www.itu.int/rec/dologin_pub.asp?lang=e&id="
        f"{recommendation_id}!!PDF-E&type=items"
    )
    result = deepcopy(dict(source))
    result.update(
        {
            "standard_number": _first(source, "number", "standard_number"),
            "version": version,
            "edition_identifier": recommendation_id,
            "official_url": landing_url,
            "artifact_url": artifact_url,
            "download_url": artifact_url,
            "filename": f"{recommendation_id}-PDF-E.pdf",
            "fetch_artifact": True,
            "retrieved_at": source.get("retrieved_at") or config_retrieved_at or _utc_now(),
            "sha256": _normal_sha256(
                source.get("sha256"), field="sha256", source_id=source_id
            ),
            "extractor_version": EXTRACTOR_VERSION,
            "status": "resolved",
        }
    )
    return result


def resolve_source(
    source: Mapping[str, Any],
    *,
    baseline: Mapping[str, Any] | None = None,
    locked: Mapping[str, Any] | None = None,
    offline: bool = False,
    refresh: bool = False,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    config_retrieved_at: Any = None,
) -> dict[str, Any]:
    """Resolve a single configuration entry into lock-ready metadata."""

    defaults = baseline or {}
    if locked and not refresh and _lock_matches_source(source, locked, defaults):
        return _merge_locked_resolution(source, locked)

    if _is_itu(source) and source.get("resolve_artifact"):
        if offline:
            raise SourceSyncError(
                f"Offline ITU-T resolution for {source['id']!r} needs an existing artifact lock"
            )
        return _resolve_itu_artifact(source, config_retrieved_at, timeout)

    # Non-DOCX standards (for example ITU-T HTML/PDF or IETF RFC sources) stay
    # in the lock for provenance but are deliberately not sent through the 3GPP
    # ZIP/DOCX extractor.
    if not _is_3gpp(source):
        return _resolve_metadata_only(source, config_retrieved_at)

    source_id = str(source["id"])
    compact, _, _ = _compact_3gpp_number(source)
    release = _first(source, "release")
    if release is None:
        release = defaults.get("3gpp_release")
    release_code_value = _first(source, "release_code")
    if release_code_value is None:
        release_code_value = defaults.get("release_code")
    release_code = _release_code(release_code_value)
    if release_code is None:
        raise SourceSyncError(
            f"3GPP source {source_id!r} needs 'release_code' or baseline.release_code"
        )

    archive_url = str(
        _first(source, "archive_directory_url", "archive_url")
        or _default_3gpp_archive(source)
    )
    explicit_download_url = _first(source, "download_url", "url")
    pinned_filename = _first(source, "filename", "pinned_filename")
    if not pinned_filename and explicit_download_url:
        possible_filename = _filename_from_url(str(explicit_download_url), source_id)
        if possible_filename and possible_filename.lower().endswith(".zip"):
            pinned_filename = possible_filename

    if pinned_filename:
        filename = _safe_filename(str(pinned_filename), source_id)
        official_url = str(explicit_download_url or urljoin(archive_url, filename))
    else:
        if offline:
            raise SourceSyncError(
                f"Offline resolution for {source_id!r} needs an existing lock or pinned filename"
            )
        filename, official_url = _resolve_latest_3gpp(
            source, archive_url, release_code, timeout
        )

    derived_version = _version_from_filename(filename, compact, release, release_code)
    version = _first(source, "version") or derived_version
    if release is None:
        release = _release_number_from_code(release_code)

    result = deepcopy(dict(source))
    result.update(
        {
            "standard_number": _first(source, "number", "standard_number"),
            "release": release,
            "release_code": release_code,
            "archive_url": archive_url,
            "filename": filename,
            "version": str(version),
            "official_url": official_url,
            "retrieved_at": config_retrieved_at or _utc_now(),
            "sha256": _normal_sha256(
                source.get("sha256"), field="sha256", source_id=source_id
            ),
            "extractor_version": EXTRACTOR_VERSION,
            "status": "resolved",
        }
    )
    return result


def resolve_sources(
    config: Mapping[str, Any],
    *,
    existing_lock: Mapping[str, Any] | None = None,
    offline: bool = False,
    refresh: bool = False,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> list[dict[str, Any]]:
    baseline = config.get("baseline") or {}
    locked_by_id = {
        str(item.get("id")): item
        for item in (existing_lock or {}).get("sources", [])
        if isinstance(item, dict) and item.get("id")
    }
    artifact_resolution_ids = {
        str(value) for value in config.get("artifact_resolution_source_ids", [])
    }
    def resolve_one(source: Mapping[str, Any]) -> dict[str, Any]:
        effective_source = dict(source)
        if str(source["id"]) in artifact_resolution_ids:
            effective_source["resolve_artifact"] = True
        try:
            return resolve_source(
                effective_source,
                baseline=baseline,
                locked=locked_by_id.get(str(source["id"])),
                offline=offline,
                refresh=refresh,
                timeout=timeout,
                config_retrieved_at=config.get("retrieved_at"),
            )
        except SourceSyncError as exc:
            fallback = _resolve_metadata_only(effective_source, config.get("retrieved_at"))
            fallback["status"] = "resolution-error"
            fallback["resolution_error"] = str(exc)
            fallback["resolution_required_for_extraction"] = bool(source.get("extract", True))
            return fallback

    sources = list(config["sources"])
    worker_count = max(1, min(8, len(sources)))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        return list(executor.map(resolve_one, sources))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise SourceSyncError(f"Cannot hash local file {path}: {exc}") from exc
    return digest.hexdigest()


def _slug(value: Any) -> str:
    result = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value)).strip("-.")
    return result or "source"


def _path_for_lock(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def _path_from_lock(value: Any, root: Path) -> Path | None:
    if not value:
        return None
    path = Path(str(value))
    return path if path.is_absolute() else root / path


def _download_temp(
    url: str, destination: Path, timeout: float, *, accept: str
) -> tuple[Path, str]:
    """Fetch a public artifact into a sibling temporary file.

    curl is preferred for the same reason as archive-index resolution: it is
    materially more reliable against the official standards sites' TLS/CDN
    edge cases.  urllib remains a portable fallback and supplies Content-Type
    when available.
    """

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="wb",
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".part",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
    curl_error: Exception | None = None
    try:
        subprocess.run(
            [
                "/usr/bin/curl",
                "-L",
                "--http1.1",
                "-f",
                "-sS",
                "--retry",
                "2",
                "--retry-all-errors",
                "--connect-timeout",
                str(max(1, min(15, int(timeout)))),
                "--max-time",
                str(max(2, int(timeout))),
                "-A",
                USER_AGENT,
                "-H",
                f"Accept: {accept}",
                "-o",
                str(temporary),
                url,
            ],
            check=True,
            capture_output=True,
            timeout=max(timeout + 10, 15),
        )
        guessed = mimetypes.guess_type(urlsplit(url).path)[0]
        return temporary, guessed or "application/octet-stream"
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        curl_error = exc
        temporary.unlink(missing_ok=True)

    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    try:
        with urlopen(request, timeout=timeout) as response, tempfile.NamedTemporaryFile(
            mode="wb",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".part",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            try:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            except Exception:
                temporary.unlink(missing_ok=True)
                raise
            media_type = response.headers.get_content_type() or "application/octet-stream"
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        if "www.3gpp.org/ftp/" in url.lower():
            try:
                return _download_3gpp_session_temp(url, destination, timeout)
            except SourceSyncError as session_error:
                raise SourceSyncError(
                    f"Cannot download {url}: curl={curl_error}; urllib={exc}; "
                    f"3gpp-session={session_error}"
                ) from session_error
        raise SourceSyncError(
            f"Cannot download {url}: curl={curl_error}; urllib={exc}"
        ) from exc
    return temporary, media_type


def _download_3gpp_session_temp(
    url: str, destination: Path, timeout: float
) -> tuple[Path, str]:
    """Retry a 3GPP ZIP through a directory session when its WAF intervenes."""

    parent_url = url.rsplit("/", 1)[0] + "/"
    with tempfile.NamedTemporaryFile(suffix=".cookies", delete=False) as cookie_handle:
        cookie_path = Path(cookie_handle.name)
    with tempfile.NamedTemporaryFile(
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".part",
        delete=False,
    ) as output_handle:
        temporary = Path(output_handle.name)
    try:
        common = [
            "/usr/bin/curl",
            "-L",
            "--http1.1",
            "-f",
            "-sS",
            "--retry",
            "5",
            "--retry-all-errors",
            "--connect-timeout",
            str(max(1, min(15, int(timeout)))),
            "--max-time",
            str(max(2, int(timeout))),
            "-A",
            "Mozilla/5.0",
        ]
        subprocess.run(
            [*common, "-c", str(cookie_path), "-o", os.devnull, parent_url],
            check=True,
            capture_output=True,
            timeout=max(timeout + 10, 15),
        )
        subprocess.run(
            [
                *common,
                "-b",
                str(cookie_path),
                "-e",
                parent_url,
                "-o",
                str(temporary),
                url,
            ],
            check=True,
            capture_output=True,
            timeout=max(timeout + 10, 15),
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        temporary.unlink(missing_ok=True)
        raise SourceSyncError(f"3GPP session download failed for {url}: {exc}") from exc
    finally:
        cookie_path.unlink(missing_ok=True)
    return temporary, "application/zip"


def _download_to(url: str, destination: Path, timeout: float) -> str:
    temporary, _ = _download_temp(
        url, destination, timeout, accept="application/zip,*/*"
    )
    digest = _sha256_file(temporary)

    if not zipfile.is_zipfile(temporary):
        temporary.unlink(missing_ok=True)
        if "www.3gpp.org/ftp/" in url.lower():
            temporary, _ = _download_3gpp_session_temp(url, destination, timeout)
        if not zipfile.is_zipfile(temporary):
            temporary.unlink(missing_ok=True)
            raise SourceSyncError(f"Downloaded payload is not a valid ZIP file: {url}")
        digest = _sha256_file(temporary)
    temporary.replace(destination)
    return digest


def _download_artifact(
    url: str, destination: Path, timeout: float
) -> tuple[str, int, str]:
    """Download a non-ZIP public artifact and return digest, size and media type."""

    temporary, media_type = _download_temp(url, destination, timeout, accept="*/*")
    digest = _sha256_file(temporary)
    byte_size = temporary.stat().st_size
    temporary.replace(destination)
    return digest, byte_size, media_type


def download_source(
    source: Mapping[str, Any],
    *,
    root: Path,
    downloads_dir: Path,
    offline: bool = False,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """Download or safely reuse the ZIP for one resolved 3GPP source."""

    result = deepcopy(dict(source))
    if source.get("extract") is False or not _is_3gpp(source):
        fetch_external = bool(source.get("fetch_artifact", False)) or _organization(source).upper() == "IETF"
        if not fetch_external:
            return result
        source_id = str(source["id"])
        artifact_url = _first(source, "download_url", "artifact_url", "official_url", "url")
        if not artifact_url:
            raise SourceSyncError(f"Metadata source {source_id!r} has no artifact URL")
        configured_filename = _first(source, "filename", "pinned_filename")
        filename = configured_filename or _filename_from_url(str(artifact_url), source_id)
        if not filename:
            filename = f"{_slug(source_id)}.html"
        filename = _safe_filename(str(filename), source_id)
        destination = downloads_dir / _slug(source_id) / filename
        expected = _normal_sha256(source.get("sha256"), field="sha256", source_id=source_id)
        if destination.exists():
            actual = _sha256_file(destination)
            if expected is None or actual == expected:
                return {
                    **result,
                    "sha256": actual,
                    "artifact_path": _path_for_lock(destination, root),
                    "artifact_url": str(artifact_url),
                    "byte_size": destination.stat().st_size,
                    "media_type": source.get("media_type", "application/octet-stream"),
                    "status": "downloaded-metadata",
                }
            if offline:
                raise SourceSyncError(
                    f"SHA-256 mismatch for cached {source_id!r}: expected {expected}, got {actual}"
                )
        if offline:
            raise SourceSyncError(
                f"Offline download for {source_id!r} cannot find cached artifact at {destination}"
            )
        actual, byte_size, media_type = _download_artifact(
            str(artifact_url), destination, timeout
        )
        if expected is not None and actual != expected:
            destination.unlink(missing_ok=True)
            raise SourceSyncError(
                f"SHA-256 mismatch for {source_id!r}: expected {expected}, got {actual}"
            )
        return {
            **result,
            "sha256": actual,
            "artifact_path": _path_for_lock(destination, root),
            "artifact_url": str(artifact_url),
            "byte_size": byte_size,
            "media_type": media_type,
            "retrieved_at": _utc_now(),
            "status": "downloaded-metadata",
        }

    source_id = str(source["id"])
    filename = source.get("filename")
    official_url = source.get("official_url")
    if not filename or not official_url:
        raise SourceSyncError(f"Resolved source {source_id!r} has no filename or official_url")

    default_path = downloads_dir / _slug(source_id) / _safe_filename(str(filename), source_id)
    locked_path = _path_from_lock(source.get("zip_path"), root)
    local_path = locked_path if locked_path and locked_path.exists() else default_path
    expected = _normal_sha256(
        source.get("sha256"), field="sha256", source_id=source_id
    )

    if local_path.exists():
        actual = _sha256_file(local_path)
        if not zipfile.is_zipfile(local_path):
            if offline:
                raise SourceSyncError(f"Cached file for {source_id!r} is not a ZIP: {local_path}")
        elif expected is None or actual == expected:
            result.update(
                {
                    "sha256": actual,
                    "zip_path": _path_for_lock(local_path, root),
                    "byte_size": local_path.stat().st_size,
                    "media_type": "application/zip",
                    "retrieved_at": source.get("retrieved_at") or _utc_now(),
                    "status": "downloaded",
                }
            )
            return result
        elif offline:
            raise SourceSyncError(
                f"SHA-256 mismatch for cached {source_id!r}: expected {expected}, got {actual}"
            )

    if offline:
        raise SourceSyncError(
            f"Offline download for {source_id!r} cannot find cached ZIP at {local_path}"
        )

    actual = _download_to(str(official_url), default_path, timeout)
    if expected is not None and actual != expected:
        # Do not leave an untrusted payload at the canonical cache location.
        default_path.unlink(missing_ok=True)
        raise SourceSyncError(
            f"SHA-256 mismatch for {source_id!r}: expected {expected}, got {actual}"
        )
    result.update(
        {
            "sha256": actual,
            "zip_path": _path_for_lock(default_path, root),
            "byte_size": default_path.stat().st_size,
            "media_type": "application/zip",
            "retrieved_at": _utc_now(),
            "status": "downloaded",
        }
    )
    return result


def _safe_zip_document_members(
    package: zipfile.ZipFile, source_id: str
) -> list[zipfile.ZipInfo]:
    members: list[zipfile.ZipInfo] = []
    basenames: set[str] = set()
    for info in package.infolist():
        if info.is_dir() or not info.filename.lower().endswith((".docx", ".doc")):
            continue
        normalized_name = info.filename.replace("\\", "/")
        path = PurePosixPath(normalized_name)
        if path.is_absolute() or ".." in path.parts:
            raise SourceSyncError(
                f"ZIP for {source_id!r} contains unsafe DOCX path {info.filename!r}"
            )
        basename = path.name
        folded = basename.casefold()
        if folded in basenames:
            raise SourceSyncError(
                f"ZIP for {source_id!r} contains duplicate DOCX basename {basename!r}"
            )
        basenames.add(folded)
        members.append(info)
    if not members:
        raise SourceSyncError(f"ZIP for {source_id!r} contains no Word document")
    return sorted(members, key=lambda item: item.filename.casefold())


def _convert_legacy_doc(source_path: Path, source_id: str) -> Path:
    """Convert a legacy binary Word artifact to DOCX for evidence extraction."""

    destination = source_path.with_suffix(".docx")
    if destination.is_file() and zipfile.is_zipfile(destination):
        return destination
    soffice = shutil.which("soffice")
    textutil = shutil.which("textutil")
    if not soffice and not textutil:
        raise SourceSyncError(
            f"ZIP for {source_id!r} contains legacy .doc content, but neither soffice nor textutil is available"
        )
    failures: list[str] = []
    if soffice:
        profile = Path(tempfile.mkdtemp(prefix="tokg-soffice-profile-", dir="/tmp"))
        output_dir = Path(tempfile.mkdtemp(prefix="tokg-soffice-output-", dir="/tmp"))
        try:
            completed = subprocess.run(
                [
                    soffice,
                    f"-env:UserInstallation={profile.as_uri()}",
                    "--headless",
                    "--convert-to",
                    "docx",
                    "--outdir",
                    str(output_dir),
                    str(source_path),
                ],
                check=True,
                capture_output=True,
                timeout=180,
            )
            candidate = output_dir / destination.name
            if candidate.is_file() and zipfile.is_zipfile(candidate):
                candidate.replace(destination)
                return destination
            failures.append(
                f"soffice: no valid DOCX output; stderr={completed.stderr.decode(errors='replace')[:300]}"
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
            failures.append(f"soffice: {exc}")
        finally:
            shutil.rmtree(profile, ignore_errors=True)
            shutil.rmtree(output_dir, ignore_errors=True)
    if textutil:
        with tempfile.NamedTemporaryFile(suffix=".docx", dir="/tmp", delete=False) as handle:
            candidate = Path(handle.name)
        candidate.unlink(missing_ok=True)
        try:
            completed = subprocess.run(
                [textutil, "-convert", "docx", "-output", str(candidate), str(source_path)],
                check=True,
                capture_output=True,
                timeout=180,
            )
            if candidate.is_file() and zipfile.is_zipfile(candidate):
                candidate.replace(destination)
                return destination
            failures.append(
                f"textutil: no valid DOCX output; stderr={completed.stderr.decode(errors='replace')[:300]}"
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
            failures.append(f"textutil: {exc}")
        finally:
            candidate.unlink(missing_ok=True)
    raise SourceSyncError(
        f"Cannot convert legacy Word document for {source_id!r}: {'; '.join(failures)}"
    )


def extract_source_docx(
    source: Mapping[str, Any], *, root: Path, extracted_dir: Path
) -> tuple[dict[str, Any], list[Path]]:
    """Extract all DOCX members from one verified source ZIP."""

    result = deepcopy(dict(source))
    if source.get("extract") is False or not _is_3gpp(source):
        return result, []
    source_id = str(source["id"])
    zip_path = _path_from_lock(source.get("zip_path"), root)
    if zip_path is None or not zip_path.is_file():
        raise SourceSyncError(
            f"Cannot extract {source_id!r}: downloaded ZIP is missing; run --download first"
        )
    expected = _normal_sha256(
        source.get("sha256"), field="sha256", source_id=source_id
    )
    actual = _sha256_file(zip_path)
    if expected is not None and actual != expected:
        raise SourceSyncError(
            f"Cannot extract {source_id!r}: ZIP SHA-256 changed (expected {expected}, got {actual})"
        )

    destination = extracted_dir / _slug(source_id) / _slug(source.get("version") or "unknown")
    destination.mkdir(parents=True, exist_ok=True)
    output_paths: list[Path] = []
    try:
        with zipfile.ZipFile(zip_path) as package:
            members = _safe_zip_document_members(package, source_id)
            for info in members:
                output = destination / PurePosixPath(info.filename.replace("\\", "/")).name
                with package.open(info) as input_handle, tempfile.NamedTemporaryFile(
                    mode="wb",
                    dir=destination,
                    prefix=f".{output.name}.",
                    suffix=".part",
                    delete=False,
                ) as output_handle:
                    temporary = Path(output_handle.name)
                    try:
                        shutil.copyfileobj(input_handle, output_handle, length=1024 * 1024)
                        output_handle.flush()
                        os.fsync(output_handle.fileno())
                    except Exception:
                        temporary.unlink(missing_ok=True)
                        raise
                temporary.replace(output)
                if output.suffix.lower() == ".docx":
                    if not zipfile.is_zipfile(output):
                        output.unlink(missing_ok=True)
                        raise SourceSyncError(
                            f"DOCX member {info.filename!r} in {source_id!r} is not a valid package"
                        )
                    output_paths.append(output)
                else:
                    output_paths.append(_convert_legacy_doc(output, source_id))
    except zipfile.BadZipFile as exc:
        raise SourceSyncError(f"Cannot extract invalid ZIP for {source_id!r}: {zip_path}") from exc
    except OSError as exc:
        raise SourceSyncError(f"Cannot extract ZIP for {source_id!r}: {exc}") from exc

    result.update(
        {
            "sha256": actual,
            "docx_paths": [_path_for_lock(path, root) for path in output_paths],
            "extractor_version": EXTRACTOR_VERSION,
            "status": "extracted",
        }
    )
    return result, output_paths


def _make_paths(
    root: str | Path,
    config_path: str | Path | None,
    lock_path: str | Path | None,
    downloads_dir: str | Path | None,
    extracted_dir: str | Path | None,
    fragments_path: str | Path | None,
) -> PipelinePaths:
    project_root = Path(root).resolve()

    def choose(value: str | Path | None, default: str) -> Path:
        path = Path(value) if value is not None else Path(default)
        return path if path.is_absolute() else project_root / path

    return PipelinePaths(
        root=project_root,
        config=choose(config_path, "config/standards.json"),
        lock=choose(lock_path, "sources/lock.json"),
        downloads=choose(downloads_dir, "sources/downloads"),
        extracted=choose(extracted_dir, "sources/extracted"),
        fragments=choose(fragments_path, "evidence/fragments.jsonl"),
    )


def _lock_payload(sources: Sequence[Mapping[str, Any]], generated_at: str) -> dict[str, Any]:
    return {
        "schema_version": LOCK_SCHEMA_VERSION,
        "generated_at": generated_at,
        "extractor_version": EXTRACTOR_VERSION,
        "sources": [dict(source) for source in sources],
    }


def cited_source_ids(project_root: Path) -> set[str]:
    """Return source IDs referenced by the checked-in catalog modules.

    This is intentionally a structural scan rather than a catalog-schema
    shortcut: evidence may appear on concepts, relations, procedures, steps,
    formulas, or nested operands.  Only dictionaries containing both a source
    and a locator qualify as evidence references.
    """

    catalog_dir = project_root / "catalog"
    result: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            source_id = value.get("source")
            if isinstance(source_id, str) and value.get("locator"):
                result.add(source_id)
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    for path in sorted(catalog_dir.glob("*.json")):
        visit(_read_json(path, "Catalog module"))
    return result


def run_pipeline(
    *,
    project_root: str | Path = ".",
    config_path: str | Path | None = None,
    lock_path: str | Path | None = None,
    downloads_dir: str | Path | None = None,
    extracted_dir: str | Path | None = None,
    fragments_path: str | Path | None = None,
    mode: str = "extract",
    offline: bool = False,
    refresh: bool = False,
    cited_only: bool = False,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """Run one pipeline phase and return a machine-readable summary.

    Modes are cumulative: ``resolve`` only writes resolved metadata,
    ``download`` additionally ensures verified ZIPs exist, and ``extract``
    additionally creates DOCX evidence fragments.
    """

    if mode not in {"resolve", "download", "extract"}:
        raise SourceSyncError(f"Unknown pipeline mode {mode!r}")
    if timeout <= 0:
        raise SourceSyncError("timeout must be greater than zero")

    paths = _make_paths(
        project_root,
        config_path,
        lock_path,
        downloads_dir,
        extracted_dir,
        fragments_path,
    )
    config = load_standards_config(paths.config)
    existing_lock = load_lock(paths.lock)
    sources = resolve_sources(
        config,
        existing_lock=existing_lock,
        offline=offline,
        refresh=refresh,
        timeout=timeout,
    )
    selected_ids = cited_source_ids(paths.root) if cited_only else None

    if mode in {"download", "extract"}:
        def download_one(source: Mapping[str, Any]) -> dict[str, Any]:
            if selected_ids is not None and source.get("id") not in selected_ids:
                return dict(source)
            try:
                return download_source(
                    source,
                    root=paths.root,
                    downloads_dir=paths.downloads,
                    offline=offline,
                    timeout=timeout,
                )
            except SourceSyncError as exc:
                raise SourceSyncError(f"Failed to download source {source['id']!r}: {exc}") from exc

        worker_count = max(1, min(2, len(sources)))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            sources = list(executor.map(download_one, sources))

    fragment_count = 0
    fragment_index_path: Path | None = None
    if mode == "extract":
        extracted_sources: list[dict[str, Any]] = []
        all_fragments: list[dict[str, Any]] = []
        for source in sources:
            if selected_ids is not None and source.get("id") not in selected_ids:
                extracted_sources.append(source)
                continue
            try:
                updated_source, docx_paths = extract_source_docx(
                    source, root=paths.root, extracted_dir=paths.extracted
                )
                extracted_sources.append(updated_source)
                for docx_path in docx_paths:
                    all_fragments.extend(extract_fragments(docx_path, updated_source))
                artifact_path = _path_from_lock(updated_source.get("artifact_path"), paths.root)
                if not docx_paths and artifact_path and artifact_path.is_file():
                    all_fragments.extend(extract_external_fragments(artifact_path, updated_source))
            except (SourceSyncError, DocxExtractionError, ExternalExtractionError) as exc:
                raise SourceSyncError(f"Failed to extract source {source['id']!r}: {exc}") from exc
        sources = extracted_sources
        fragment_count = write_fragments_jsonl(all_fragments, paths.fragments)
        fragment_index_path = paths.fragments.with_suffix(".sqlite")
        indexed_count = build_fragment_index(paths.fragments, fragment_index_path)
        if indexed_count != fragment_count:
            raise SourceSyncError(
                f"Fragment index count {indexed_count} does not match JSONL count {fragment_count}"
            )

    generated_at = _utc_now()
    _atomic_write_json(paths.lock, _lock_payload(sources, generated_at))
    return {
        "mode": mode,
        "offline": offline,
        "source_count": len(sources),
        "selected_source_count": len(selected_ids) if selected_ids is not None else len(sources),
        "extractable_source_count": sum(
            1 for source in sources if source.get("extract") is not False and _is_3gpp(source)
        ),
        "fragment_count": fragment_count,
        "lock_path": _path_for_lock(paths.lock, paths.root),
        "fragments_path": _path_for_lock(paths.fragments, paths.root) if mode == "extract" else None,
        "fragment_index_path": (
            _path_for_lock(fragment_index_path, paths.root) if fragment_index_path else None
        ),
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tokg-sync-sources",
        description="Resolve and lock official standards, download verified ZIPs, and extract DOCX evidence.",
    )
    parser.add_argument("--project-root", default=".", help="Project root (default: current directory)")
    parser.add_argument("--config", default=None, help="standards.json path, relative to project root")
    parser.add_argument("--lock", default=None, help="lock.json path, relative to project root")
    parser.add_argument("--downloads-dir", default=None, help="download cache directory")
    parser.add_argument("--extracted-dir", default=None, help="DOCX extraction directory")
    parser.add_argument("--fragments", default=None, help="fragments.jsonl output path")
    phases = parser.add_mutually_exclusive_group()
    phases.add_argument(
        "--resolve-only",
        action="store_true",
        help="only resolve/pin source versions and write sources/lock.json",
    )
    phases.add_argument(
        "--download",
        action="store_true",
        help="resolve and download/check ZIPs, but do not extract DOCX",
    )
    phases.add_argument(
        "--extract",
        action="store_true",
        help="resolve, download/reuse, and extract evidence (default)",
    )
    parser.add_argument(
        "--cited-only",
        action="store_true",
        help="download/extract only sources referenced by catalog evidence (all sources remain locked)",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        default=os.environ.get("TOKG_OFFLINE", "").lower() in {"1", "true", "yes"},
        help="forbid network access and reuse the lock/cache",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="ignore unpinned versions in the existing lock and resolve the latest archive entry",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"network timeout in seconds (default: {DEFAULT_TIMEOUT_SECONDS:g})",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    mode = "resolve" if args.resolve_only else "download" if args.download else "extract"
    try:
        summary = run_pipeline(
            project_root=args.project_root,
            config_path=args.config,
            lock_path=args.lock,
            downloads_dir=args.downloads_dir,
            extracted_dir=args.extracted_dir,
            fragments_path=args.fragments,
            mode=mode,
            offline=args.offline,
            refresh=args.refresh,
            cited_only=args.cited_only,
            timeout=args.timeout,
        )
    except SourceSyncError as exc:
        parser.exit(2, f"error: {exc}\n")
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised by the console script
    raise SystemExit(main())


__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "LOCK_SCHEMA_VERSION",
    "PipelinePaths",
    "SourceSyncError",
    "download_source",
    "cited_source_ids",
    "extract_source_docx",
    "load_lock",
    "load_standards_config",
    "main",
    "resolve_source",
    "resolve_sources",
    "run_pipeline",
]
