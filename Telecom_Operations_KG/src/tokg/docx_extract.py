"""Deterministic, dependency-free extraction of evidence blocks from DOCX.

The extractor deliberately uses only the Python standard library.  A DOCX file
is a ZIP package containing WordprocessingML; walking ``w:body`` children keeps
paragraphs and tables in the same order in which a reader sees them.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import tempfile
from typing import Any
import zipfile
from xml.etree import ElementTree as ET


EXTRACTOR_VERSION = "docx-stdlib-v1"

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_W = f"{{{_W_NS}}}"
_XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

_NUMBERED_SECTION_RE = re.compile(
    r"^\s*(?P<number>\d+(?:\.\d+){0,9})\s+(?P<title>\S(?:.*\S)?)\s*$"
)
_ANNEX_RE = re.compile(
    r"^\s*(?P<number>Annex\s+[A-Z](?:\.[A-Z0-9]+)*)"
    r"(?:\s*\([^)]*\))?\s*(?::|[-\u2013\u2014])?\s*(?P<title>.*?)\s*$",
    re.IGNORECASE,
)
_HEADING_NAME_RE = re.compile(r"^(?:heading|titre|\u6807\u9898)\s*([1-9])$", re.IGNORECASE)


class DocxExtractionError(RuntimeError):
    """Raised when a DOCX package cannot be parsed into evidence blocks."""


@dataclass(frozen=True)
class DocumentBlock:
    """A paragraph or a table in document order."""

    block_type: str
    text: str
    style_id: str | None = None
    table: tuple[tuple[str, ...], ...] | None = None
    automatic_number: str | None = None


@dataclass(frozen=True)
class Heading:
    number: str | None
    title: str


@dataclass(frozen=True)
class StyleMetadata:
    name: str | None = None
    outline_level: int | None = None
    num_id: str | None = None
    numbering_level: int | None = None
    based_on: str | None = None


@dataclass(frozen=True)
class NumberingLevel:
    start: int
    number_format: str
    level_text: str


def _normalize_text(value: str) -> str:
    """Normalize layout whitespace without changing meaningful line breaks."""

    lines: list[str] = []
    for line in value.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = re.sub(r"[ \t\f\v]+", " ", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def _paragraph_text(paragraph: ET.Element) -> str:
    pieces: list[str] = []
    for element in paragraph.iter():
        if element.tag == f"{_W}t":
            text = element.text or ""
            # Word normally relies on xml:space only for leading/trailing spaces,
            # but retaining the text in either case is the least lossy behavior.
            if element.get(_XML_SPACE) == "preserve":
                pieces.append(text)
            else:
                pieces.append(text)
        elif element.tag == f"{_W}tab":
            pieces.append("\t")
        elif element.tag in {f"{_W}br", f"{_W}cr"}:
            pieces.append("\n")
        elif element.tag == f"{_W}noBreakHyphen":
            pieces.append("\u2011")
        elif element.tag == f"{_W}softHyphen":
            pieces.append("\u00ad")
    return _normalize_text("".join(pieces))


def _paragraph_style(paragraph: ET.Element) -> str | None:
    p_pr = paragraph.find(f"{_W}pPr")
    if p_pr is None:
        return None
    style = p_pr.find(f"{_W}pStyle")
    if style is None:
        return None
    return style.get(f"{_W}val")


def _cell_text(cell: ET.Element) -> str:
    parts = [_paragraph_text(p) for p in cell.iter(f"{_W}p")]
    return _normalize_text("\n".join(part for part in parts if part))


def _table_rows(table: ET.Element) -> tuple[tuple[str, ...], ...]:
    rows: list[tuple[str, ...]] = []
    for row in table.findall(f"{_W}tr"):
        rows.append(tuple(_cell_text(cell) for cell in row.findall(f"{_W}tc")))
    return tuple(rows)


def _table_text(rows: tuple[tuple[str, ...], ...]) -> str:
    # Tabs and newlines give consumers an unambiguous, deterministic rendering
    # while the structured rows remain available in the fragment as ``table``.
    return _normalize_text("\n".join("\t".join(row) for row in rows))


def _read_styles(package: zipfile.ZipFile) -> dict[str, StyleMetadata]:
    """Read paragraph styles, including inherited outline/numbering metadata."""

    try:
        payload = package.read("word/styles.xml")
    except KeyError:
        return {}
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise DocxExtractionError(f"Invalid word/styles.xml: {exc}") from exc

    raw_styles: dict[str, StyleMetadata] = {}
    for style in root.findall(f"{_W}style"):
        if style.get(f"{_W}type") not in {None, "paragraph"}:
            continue
        style_id = style.get(f"{_W}styleId")
        if not style_id:
            continue
        name_element = style.find(f"{_W}name")
        name = name_element.get(f"{_W}val") if name_element is not None else None
        outline_element = style.find(f"{_W}pPr/{_W}outlineLvl")
        outline: int | None = None
        if outline_element is not None:
            try:
                outline = int(outline_element.get(f"{_W}val", "")) + 1
            except ValueError:
                outline = None
        num_id_element = style.find(f"{_W}pPr/{_W}numPr/{_W}numId")
        level_element = style.find(f"{_W}pPr/{_W}numPr/{_W}ilvl")
        based_on_element = style.find(f"{_W}basedOn")
        num_id = num_id_element.get(f"{_W}val") if num_id_element is not None else None
        numbering_level: int | None = None
        if level_element is not None:
            try:
                numbering_level = int(level_element.get(f"{_W}val", ""))
            except ValueError:
                numbering_level = None
        raw_styles[style_id] = StyleMetadata(
            name=name,
            outline_level=outline,
            num_id=num_id,
            numbering_level=numbering_level,
            based_on=(
                based_on_element.get(f"{_W}val") if based_on_element is not None else None
            ),
        )

    resolved: dict[str, StyleMetadata] = {}

    def resolve(style_id: str, visiting: set[str]) -> StyleMetadata:
        if style_id in resolved:
            return resolved[style_id]
        current = raw_styles[style_id]
        if not current.based_on or current.based_on not in raw_styles or style_id in visiting:
            resolved[style_id] = current
            return current
        parent = resolve(current.based_on, visiting | {style_id})
        merged = StyleMetadata(
            name=current.name or parent.name,
            outline_level=(
                current.outline_level
                if current.outline_level is not None
                else parent.outline_level
            ),
            num_id=current.num_id if current.num_id is not None else parent.num_id,
            numbering_level=(
                current.numbering_level
                if current.numbering_level is not None
                else parent.numbering_level
            ),
            based_on=current.based_on,
        )
        resolved[style_id] = merged
        return merged

    for style_id in raw_styles:
        resolve(style_id, set())
    return resolved


def _parse_numbering_level(element: ET.Element) -> tuple[int, NumberingLevel] | None:
    try:
        level = int(element.get(f"{_W}ilvl", ""))
    except ValueError:
        return None
    start_element = element.find(f"{_W}start")
    format_element = element.find(f"{_W}numFmt")
    text_element = element.find(f"{_W}lvlText")
    try:
        start = int(start_element.get(f"{_W}val", "1")) if start_element is not None else 1
    except ValueError:
        start = 1
    number_format = (
        format_element.get(f"{_W}val", "decimal")
        if format_element is not None
        else "decimal"
    )
    level_text = (
        text_element.get(f"{_W}val", f"%{level + 1}")
        if text_element is not None
        else f"%{level + 1}"
    )
    return level, NumberingLevel(start, number_format, level_text)


def _read_numbering(
    package: zipfile.ZipFile,
) -> tuple[dict[tuple[str, int], NumberingLevel], dict[str, tuple[str, int]]]:
    """Resolve Word abstract numbering definitions to concrete ``numId`` values."""

    try:
        payload = package.read("word/numbering.xml")
    except KeyError:
        return {}, {}
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise DocxExtractionError(f"Invalid word/numbering.xml: {exc}") from exc

    abstracts: dict[str, dict[int, NumberingLevel]] = {}
    abstract_style_links: dict[tuple[str, int], str] = {}
    for abstract in root.findall(f"{_W}abstractNum"):
        abstract_id = abstract.get(f"{_W}abstractNumId")
        if abstract_id is None:
            continue
        levels: dict[int, NumberingLevel] = {}
        for level_element in abstract.findall(f"{_W}lvl"):
            parsed = _parse_numbering_level(level_element)
            if parsed is not None:
                levels[parsed[0]] = parsed[1]
                paragraph_style = level_element.find(f"{_W}pStyle")
                if paragraph_style is not None and paragraph_style.get(f"{_W}val"):
                    abstract_style_links[(abstract_id, parsed[0])] = str(
                        paragraph_style.get(f"{_W}val")
                    )
        abstracts[abstract_id] = levels

    concrete: dict[tuple[str, int], NumberingLevel] = {}
    style_links: dict[str, tuple[str, int]] = {}
    for numbering in root.findall(f"{_W}num"):
        num_id = numbering.get(f"{_W}numId")
        abstract_id_element = numbering.find(f"{_W}abstractNumId")
        if num_id is None or abstract_id_element is None:
            continue
        abstract_id = abstract_id_element.get(f"{_W}val")
        if abstract_id is None:
            continue
        levels = dict(abstracts.get(abstract_id, {}))
        for override in numbering.findall(f"{_W}lvlOverride"):
            try:
                level_index = int(override.get(f"{_W}ilvl", ""))
            except ValueError:
                continue
            replacement = override.find(f"{_W}lvl")
            if replacement is not None:
                parsed = _parse_numbering_level(replacement)
                if parsed is not None:
                    levels[level_index] = parsed[1]
                paragraph_style = replacement.find(f"{_W}pStyle")
                if paragraph_style is not None and paragraph_style.get(f"{_W}val"):
                    style_links[str(paragraph_style.get(f"{_W}val"))] = (
                        num_id,
                        level_index,
                    )
            start_override = override.find(f"{_W}startOverride")
            if start_override is not None and level_index in levels:
                try:
                    start = int(start_override.get(f"{_W}val", ""))
                except ValueError:
                    start = levels[level_index].start
                previous = levels[level_index]
                levels[level_index] = NumberingLevel(
                    start, previous.number_format, previous.level_text
                )
        for level_index, definition in levels.items():
            concrete[(num_id, level_index)] = definition
            linked_style = abstract_style_links.get((abstract_id, level_index))
            if linked_style and linked_style not in style_links:
                style_links[linked_style] = (num_id, level_index)
    return concrete, style_links


def _paragraph_numbering(
    paragraph: ET.Element,
    style_id: str | None,
    styles: Mapping[str, StyleMetadata],
    style_numbering: Mapping[str, tuple[str, int]],
) -> tuple[str, int] | None:
    p_pr = paragraph.find(f"{_W}pPr")
    direct_num_id: str | None = None
    direct_level: int | None = None
    if p_pr is not None:
        num_id_element = p_pr.find(f"{_W}numPr/{_W}numId")
        level_element = p_pr.find(f"{_W}numPr/{_W}ilvl")
        if num_id_element is not None:
            direct_num_id = num_id_element.get(f"{_W}val")
        if level_element is not None:
            try:
                direct_level = int(level_element.get(f"{_W}val", ""))
            except ValueError:
                direct_level = None
    style = styles.get(style_id or "", StyleMetadata())
    linked = style_numbering.get(style_id or "")
    num_id = direct_num_id if direct_num_id is not None else style.num_id
    if num_id is None and linked is not None:
        num_id = linked[0]
    level = direct_level if direct_level is not None else style.numbering_level
    if level is None and linked is not None:
        level = linked[1]
    if level is None and style.outline_level is not None:
        level = max(0, style.outline_level - 1)
    if num_id in {None, "0"}:
        return None
    return num_id, level or 0


def _letters(value: int, uppercase: bool) -> str:
    if value <= 0:
        return str(value)
    result = ""
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr((65 if uppercase else 97) + remainder) + result
    return result


def _roman(value: int) -> str:
    numerals = (
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    )
    result = ""
    for unit, numeral in numerals:
        count, value = divmod(value, unit)
        result += numeral * count
    return result


def _format_counter(value: int, number_format: str) -> str:
    if number_format == "upperLetter":
        return _letters(value, True)
    if number_format == "lowerLetter":
        return _letters(value, False)
    if number_format == "upperRoman":
        return _roman(value)
    if number_format == "lowerRoman":
        return _roman(value).lower()
    if number_format == "decimalZero":
        return f"{value:02d}"
    if number_format in {"bullet", "none"}:
        return ""
    return str(value)


def _next_automatic_number(
    num_id: str,
    level: int,
    definitions: Mapping[tuple[str, int], NumberingLevel],
    counters: dict[str, dict[int, int]],
) -> str | None:
    definition = definitions.get((num_id, level))
    if definition is None:
        return None
    values = counters.setdefault(num_id, {})
    for deeper_level in [candidate for candidate in values if candidate > level]:
        del values[deeper_level]
    values[level] = values.get(level, definition.start - 1) + 1
    for parent_level in range(level):
        if parent_level not in values:
            parent = definitions.get((num_id, parent_level))
            if parent is not None:
                values[parent_level] = parent.start

    rendered = definition.level_text
    for referenced_level in range(9):
        marker = f"%{referenced_level + 1}"
        if marker not in rendered:
            continue
        referenced = definitions.get((num_id, referenced_level))
        replacement = ""
        if referenced is not None and referenced_level in values:
            replacement = _format_counter(values[referenced_level], referenced.number_format)
        rendered = rendered.replace(marker, replacement)
    return rendered.strip() or None


def iter_document_blocks(docx_path: str | Path) -> Iterator[DocumentBlock]:
    """Yield non-empty paragraphs and tables in exact ``w:body`` order."""

    path = Path(docx_path)
    if not path.is_file():
        raise DocxExtractionError(f"DOCX file does not exist: {path}")

    try:
        with zipfile.ZipFile(path) as package:
            try:
                document_xml = package.read("word/document.xml")
            except KeyError as exc:
                raise DocxExtractionError(
                    f"Not a valid DOCX package (missing word/document.xml): {path}"
                ) from exc
            styles = _read_styles(package)
            numbering, style_numbering = _read_numbering(package)
    except zipfile.BadZipFile as exc:
        raise DocxExtractionError(f"Not a valid ZIP/DOCX package: {path}") from exc

    try:
        root = ET.fromstring(document_xml)
    except ET.ParseError as exc:
        raise DocxExtractionError(f"Invalid word/document.xml in {path}: {exc}") from exc

    body = root.find(f"{_W}body")
    if body is None:
        raise DocxExtractionError(f"DOCX has no w:body: {path}")

    counters: dict[str, dict[int, int]] = {}
    for child in body:
        if child.tag == f"{_W}p":
            text = _paragraph_text(child)
            if text:
                style_id = _paragraph_style(child)
                numbering_properties = _paragraph_numbering(
                    child, style_id, styles, style_numbering
                )
                automatic_number = None
                if numbering_properties is not None:
                    automatic_number = _next_automatic_number(
                        numbering_properties[0],
                        numbering_properties[1],
                        numbering,
                        counters,
                    )
                yield DocumentBlock(
                    "paragraph",
                    text,
                    style_id,
                    automatic_number=automatic_number,
                )
        elif child.tag == f"{_W}tbl":
            rows = _table_rows(child)
            text = _table_text(rows)
            if text:
                yield DocumentBlock("table", text, table=rows)


def _load_style_metadata(docx_path: Path) -> dict[str, StyleMetadata]:
    try:
        with zipfile.ZipFile(docx_path) as package:
            return _read_styles(package)
    except zipfile.BadZipFile as exc:
        raise DocxExtractionError(f"Not a valid ZIP/DOCX package: {docx_path}") from exc


def _looks_like_heading_style(
    style_id: str | None, styles: Mapping[str, StyleMetadata]
) -> bool:
    if not style_id:
        return False
    metadata = styles.get(style_id, StyleMetadata())
    if metadata.outline_level is not None:
        return True
    candidates = [style_id, metadata.name or ""]
    return any(_HEADING_NAME_RE.match(candidate.replace("_", " ")) for candidate in candidates)


def _heading_from_block(
    block: DocumentBlock, styles: Mapping[str, StyleMetadata]
) -> Heading | None:
    if block.block_type != "paragraph" or "\n" in block.text:
        return None

    numbered = _NUMBERED_SECTION_RE.match(block.text)
    annex = _ANNEX_RE.match(block.text)
    is_heading_style = _looks_like_heading_style(block.style_id, styles)

    if annex and (is_heading_style or len(block.text) <= 240):
        title = annex.group("title") or annex.group("number")
        return Heading(annex.group("number"), title.strip())

    # Numbered section detection is intentionally conservative for body text.
    # 3GPP headings are short; prose/list items that happen to start with a
    # number are usually longer or end in sentence punctuation.
    if numbered and (
        is_heading_style
        or (
            len(block.text) <= 240
            and len(numbered.group("title").split()) <= 24
            and not numbered.group("title").endswith((".", ";"))
        )
    ):
        return Heading(numbered.group("number"), numbered.group("title").strip())

    if is_heading_style and block.automatic_number:
        number = block.automatic_number.rstrip(".\t ")
        return Heading(number or None, block.text)

    if is_heading_style and len(block.text) <= 300:
        return Heading(None, block.text)
    return None


def _source_value(source: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        value = source.get(key)
        if value is not None and value != "":
            return value
    return None


def _source_identity(source: Mapping[str, Any], docx_path: Path) -> str:
    organization = str(_source_value(source, "organization", "org") or "unknown")
    number = str(
        _source_value(source, "standard_number", "number", "standard", "specification")
        or docx_path.stem
    )
    version = str(_source_value(source, "version", "edition") or "unknown")
    release = str(_source_value(source, "release") or "")
    return "|".join((organization, number, version, release))


def extract_fragments(
    docx_path: str | Path, source: Mapping[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Extract deterministic evidence fragments from one DOCX document.

    ``source`` is normally a record from ``sources/lock.json``.  Its provenance
    fields are copied into every fragment, which makes each JSONL row usable on
    its own and keeps downstream graph statements traceable.
    """

    path = Path(docx_path)
    provenance: Mapping[str, Any] = source or {}
    styles = _load_style_metadata(path)
    identity = _source_identity(provenance, path)

    organization = _source_value(provenance, "organization", "org")
    standard_number = _source_value(
        provenance, "standard_number", "number", "standard", "specification"
    )
    version = _source_value(provenance, "version", "edition")
    release = _source_value(provenance, "release")
    official_url = _source_value(
        provenance, "official_url", "download_url", "url", "archive_url"
    )
    source_sha256 = _source_value(provenance, "sha256")

    current_heading = Heading(None, "")
    section_occurrence = 0
    fragments: list[dict[str, Any]] = []

    for block_index, block in enumerate(iter_document_blocks(path), start=1):
        heading = _heading_from_block(block, styles)
        if heading is not None:
            current_heading = heading
            section_occurrence = 0
        section_occurrence += 1

        content_sha256 = hashlib.sha256(block.text.encode("utf-8")).hexdigest()
        stable_key = "\x1f".join(
            (
                identity,
                current_heading.number or current_heading.title,
                block.block_type,
                str(section_occurrence),
                content_sha256,
            )
        )
        fragment_id = f"frag-{hashlib.sha256(stable_key.encode('utf-8')).hexdigest()[:24]}"

        fragment: dict[str, Any] = {
            "fragment_id": fragment_id,
            "source_id": provenance.get("id"),
            "organization": organization,
            "standard_number": standard_number,
            "version": version,
            "release": release,
            "official_url": official_url,
            "source_sha256": source_sha256,
            "source_file": path.name,
            "block_index": block_index,
            "block_type": block.block_type,
            "section_number": current_heading.number,
            "section_title": current_heading.title or None,
            "text": block.text,
            "content_hash": content_sha256,
            "content_hash_algorithm": "sha256",
            "extractor_version": EXTRACTOR_VERSION,
        }
        if block.table is not None:
            fragment["table"] = [list(row) for row in block.table]
        fragments.append(fragment)

    return fragments


def write_fragments_jsonl(
    fragments: Iterable[Mapping[str, Any]], output_path: str | Path
) -> int:
    """Atomically write fragments as canonical UTF-8 JSON Lines."""

    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        newline="\n",
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
        try:
            for fragment in fragments:
                handle.write(
                    json.dumps(
                        dict(fragment), ensure_ascii=False, sort_keys=True, separators=(",", ":")
                    )
                )
                handle.write("\n")
                count += 1
            handle.flush()
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    temporary.replace(destination)
    return count


__all__ = [
    "DocumentBlock",
    "DocxExtractionError",
    "EXTRACTOR_VERSION",
    "extract_fragments",
    "iter_document_blocks",
    "write_fragments_jsonl",
]
