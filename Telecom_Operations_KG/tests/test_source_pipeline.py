from __future__ import annotations

import hashlib
import json
from pathlib import Path
import zipfile

import pytest
from rdflib import URIRef

from tokg.docx_extract import EXTRACTOR_VERSION, extract_fragments, iter_document_blocks
from tokg.fragment_index import FragmentIndex, build_fragment_index
from tokg.model import assertion_digest, evidence_digest, sha256_text
from tokg.source_sync import SourceSyncError, cited_source_ids, resolve_source, run_pipeline


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def test_evidence_span_identity_distinguishes_exact_quotes() -> None:
    fragment_hash = "a" * 64
    first = evidence_digest("rfc-test", "Section 1", fragment_hash, sha256_text("first span"))
    second = evidence_digest("rfc-test", "Section 1", fragment_hash, sha256_text("second span"))
    assert first != second
    first_artifact = evidence_digest(
        "rfc-test", "Section 1", fragment_hash, sha256_text("first span"), "b" * 64, "fragment-1"
    )
    second_artifact = evidence_digest(
        "rfc-test", "Section 1", fragment_hash, sha256_text("first span"), "c" * 64, "fragment-1"
    )
    assert first_artifact != second_artifact


def test_assertion_identity_distinguishes_epistemic_metadata() -> None:
    subject = URIRef("https://example.test/subject")
    predicate = URIRef("https://example.test/predicate")
    obj = URIRef("https://example.test/object")
    reviewed = assertion_digest(subject, predicate, obj, status="reviewed")
    proposed = assertion_digest(subject, predicate, obj, status="proposed")
    derived = assertion_digest(
        subject,
        predicate,
        obj,
        modality="derived",
        derivation_rule="operator projection",
    )
    assert len({reviewed, proposed, derived}) == 3


def _paragraph(text: str, style: str | None = None) -> str:
    properties = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{properties}<w:r><w:t>{text}</w:t></w:r></w:p>"


def _table(rows: list[list[str]]) -> str:
    rendered_rows = []
    for row in rows:
        cells = "".join(f"<w:tc>{_paragraph(value)}</w:tc>" for value in row)
        rendered_rows.append(f"<w:tr>{cells}</w:tr>")
    return f"<w:tbl>{''.join(rendered_rows)}</w:tbl>"


def _make_docx(path: Path) -> None:
    body = "".join(
        [
            _paragraph("4 System architecture", "Heading1"),
            _paragraph("The UE accesses the 5G Core through the NG-RAN."),
            _table([["Entity", "Interface"], ["UE", "Uu"]]),
            _paragraph("4.1 Registration procedure", "Heading2"),
            _paragraph("The AMF handles the Registration Request."),
        ]
    )
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W_NS}"><w:body>{body}<w:sectPr/></w:body></w:document>'
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:styles xmlns:w="{W_NS}">'
        '<w:style w:type="paragraph" w:styleId="Heading1">'
        '<w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading2">'
        '<w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>'
        "</w:styles>"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as package:
        package.writestr("word/document.xml", document)
        package.writestr("word/styles.xml", styles)


def _make_automatically_numbered_docx(path: Path) -> None:
    body = "".join(
        [
            _paragraph("System architecture", "Heading1"),
            _paragraph("Architecture body."),
            _paragraph("Registration procedure", "Heading2"),
            _paragraph("Procedure body."),
        ]
    )
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W_NS}"><w:body>{body}<w:sectPr/></w:body></w:document>'
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:styles xmlns:w="{W_NS}">'
        '<w:style w:type="paragraph" w:styleId="Heading1">'
        '<w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
        '<w:style w:type="paragraph" w:styleId="Heading2">'
        '<w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>'
        "</w:styles>"
    )
    numbering = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:numbering xmlns:w="{W_NS}">'
        '<w:abstractNum w:abstractNumId="10">'
        '<w:lvl w:ilvl="0"><w:start w:val="4"/><w:numFmt w:val="decimal"/>'
        '<w:pStyle w:val="Heading1"/><w:lvlText w:val="%1"/></w:lvl>'
        '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/>'
        '<w:pStyle w:val="Heading2"/><w:lvlText w:val="%1.%2"/></w:lvl>'
        '</w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="10"/></w:num>'
        "</w:numbering>"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as package:
        package.writestr("word/document.xml", document)
        package.writestr("word/styles.xml", styles)
        package.writestr("word/numbering.xml", numbering)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _jsonl(path: Path) -> list[dict[str, object]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_docx_extraction_preserves_block_order_and_section_context(tmp_path: Path) -> None:
    docx = tmp_path / "23501-i20.docx"
    _make_docx(docx)

    blocks = list(iter_document_blocks(docx))
    assert [block.block_type for block in blocks] == [
        "paragraph",
        "paragraph",
        "table",
        "paragraph",
        "paragraph",
    ]

    provenance = {
        "organization": "3GPP",
        "number": "23.501",
        "version": "18.2.0",
        "release": 18,
        "official_url": "https://example.test/23501-i20.zip",
        "sha256": "a" * 64,
    }
    first = extract_fragments(docx, provenance)
    second = extract_fragments(docx, provenance)

    assert first == second
    assert [fragment["fragment_id"] for fragment in first] == [
        fragment["fragment_id"] for fragment in second
    ]
    assert first[2]["section_number"] == "4"
    assert first[2]["section_title"] == "System architecture"
    assert first[2]["table"] == [["Entity", "Interface"], ["UE", "Uu"]]
    assert first[4]["section_number"] == "4.1"
    assert first[4]["section_title"] == "Registration procedure"
    assert first[4]["content_hash"] == hashlib.sha256(
        first[4]["text"].encode("utf-8")
    ).hexdigest()
    assert first[4]["extractor_version"] == EXTRACTOR_VERSION


def test_docx_automatic_heading_numbering_is_rendered(tmp_path: Path) -> None:
    docx = tmp_path / "automatic-numbering.docx"
    _make_automatically_numbered_docx(docx)

    fragments = extract_fragments(docx, {"number": "23.501", "version": "18.2.0"})
    assert fragments[0]["text"] == "System architecture"
    assert fragments[0]["section_number"] == "4"
    assert fragments[1]["section_number"] == "4"
    assert fragments[2]["section_number"] == "4.1"
    assert fragments[3]["section_number"] == "4.1"


def test_3gpp_archive_resolution_selects_latest_matching_release(monkeypatch: pytest.MonkeyPatch) -> None:
    listing = """
    <html><body>
      <a href="23501-h99.zip">wrong release</a>
      <a href="23501-i10.zip">old</a>
      <a href="23501-i2a.zip">latest</a>
      <a href="23502-i99.zip">wrong spec</a>
    </body></html>
    """
    monkeypatch.setattr("tokg.source_sync._fetch_text", lambda url, timeout: listing)
    source = {
        "id": "3gpp-ts-23.501",
        "organization": "3GPP",
        "document_type": "TS",
        "number": "23.501",
        "archive_directory_url": "https://www.3gpp.org/ftp/Specs/archive/23_series/23.501/",
        "extract": True,
    }

    resolved = resolve_source(
        source, baseline={"3gpp_release": 18, "release_code": "i"}
    )
    assert resolved["filename"] == "23501-i2a.zip"
    assert resolved["version"] == "18.2.10"
    assert resolved["release"] == 18
    assert resolved["official_url"].endswith("/23501-i2a.zip")

    pinned = resolve_source(
        {**source, "filename": "23501-i10.zip"},
        baseline={"3gpp_release": 18, "release_code": "i"},
        offline=True,
    )
    assert pinned["version"] == "18.1.0"


def test_3gpp_multi_part_number_uses_official_archive_naming(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    listing = '<a href="32111-1-i10.zip">old</a><a href="32111-1-ia0.zip">new</a>'
    monkeypatch.setattr("tokg.source_sync._fetch_text", lambda url, timeout: listing)
    source = {
        "id": "3gpp-ts-32.111-1",
        "organization": "3GPP",
        "document_type": "TS",
        "number": "32.111-1",
        "extract": True,
    }

    resolved = resolve_source(
        source, baseline={"3gpp_release": 18, "release_code": "i"}
    )
    assert resolved["archive_url"].endswith("/32_series/32.111-1/")
    assert resolved["filename"] == "32111-1-ia0.zip"
    assert resolved["version"] == "18.10.0"


def test_itu_resolution_pins_latest_base_edition_and_public_pdf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    listing = """
      <a href="./recommendation.asp?lang=en&amp;parent=T-REC-Y.1540-201912-I">base</a>
      <a href="./recommendation.asp?lang=en&amp;parent=T-REC-Y.1540-202002-I!Amd1">amendment</a>
      <a href="./recommendation.asp?lang=en&amp;parent=T-REC-Y.1540-200711-I">old</a>
    """
    monkeypatch.setattr("tokg.source_sync._fetch_text", lambda url, timeout: listing)
    resolved = resolve_source(
        {
            "id": "itu-t-y.1540",
            "organization": "ITU-T",
            "document_type": "Recommendation",
            "number": "Y.1540",
            "official_url": "https://www.itu.int/rec/T-REC-Y.1540/en",
            "resolve_artifact": True,
            "extract": True,
        }
    )

    assert resolved["version"] == "2019-12"
    assert resolved["edition_identifier"] == "T-REC-Y.1540-201912-I"
    assert resolved["filename"] == "T-REC-Y.1540-201912-I-PDF-E.pdf"
    assert "T-REC-Y.1540-201912-I!!PDF-E" in resolved["download_url"]
    assert resolved["fetch_artifact"] is True


def test_full_pipeline_locks_hash_extracts_and_reuses_offline(tmp_path: Path) -> None:
    remote_docx = tmp_path / "remote" / "23501-i20.docx"
    _make_docx(remote_docx)
    remote_zip = tmp_path / "remote" / "23501-i20.zip"
    with zipfile.ZipFile(remote_zip, "w", compression=zipfile.ZIP_DEFLATED) as package:
        package.write(remote_docx, "payload/23501-i20.docx")

    config_dir = tmp_path / "config"
    config_dir.mkdir()
    config = {
        "schema_version": "1.0",
        "retrieved_at": "2026-07-20T00:00:00Z",
        "baseline": {"3gpp_release": 18, "release_code": "i"},
        "sources": [
            {
                "id": "3gpp-ts-23.501",
                "organization": "3GPP",
                "document_type": "TS",
                "number": "23.501",
                "title": "System architecture for the 5G System",
                "series": "23",
                "release": 18,
                "release_code": "i",
                "archive_directory_url": remote_zip.parent.as_uri() + "/",
                "download_url": remote_zip.as_uri(),
                "filename": remote_zip.name,
                "sha256": _sha256(remote_zip),
                "domains": ["5g-core"],
                "tier": "primary",
                "extract": True,
            },
            {
                "id": "itu-t-e.800",
                "organization": "ITU-T",
                "document_type": "Recommendation",
                "number": "E.800",
                "title": "Quality of service concepts",
                "edition": "2008-09",
                "url": "https://www.itu.int/rec/T-REC-E.800/",
                "extract": False,
            },
        ],
    }
    (config_dir / "standards.json").write_text(
        json.dumps(config), encoding="utf-8"
    )

    summary = run_pipeline(project_root=tmp_path, mode="extract")
    assert summary["source_count"] == 2
    assert summary["extractable_source_count"] == 1
    assert summary["fragment_count"] == 5

    lock = json.loads((tmp_path / "sources" / "lock.json").read_text(encoding="utf-8"))
    locked_3gpp = lock["sources"][0]
    assert locked_3gpp["domains"] == ["5g-core"]  # original metadata is retained
    assert locked_3gpp["standard_number"] == "23.501"
    assert locked_3gpp["version"] == "18.2.0"
    assert locked_3gpp["release"] == 18
    assert locked_3gpp["official_url"] == remote_zip.as_uri()
    assert locked_3gpp["sha256"] == _sha256(remote_zip)
    assert locked_3gpp["retrieved_at"].endswith("Z")
    assert locked_3gpp["extractor_version"] == EXTRACTOR_VERSION
    assert locked_3gpp["docx_paths"] == [
        "sources/extracted/3gpp-ts-23.501/18.2.0/23501-i20.docx"
    ]
    assert lock["sources"][1]["status"] == "metadata-only"

    fragments_path = tmp_path / "evidence" / "fragments.jsonl"
    online_fragments = fragments_path.read_bytes()
    fragments = _jsonl(fragments_path)
    assert all(fragment["official_url"] == remote_zip.as_uri() for fragment in fragments)
    assert all(fragment["source_sha256"] == _sha256(remote_zip) for fragment in fragments)

    # The upstream location is gone, proving this run can only use lock + cache.
    remote_zip.unlink()
    offline_summary = run_pipeline(project_root=tmp_path, mode="extract", offline=True)
    assert offline_summary["fragment_count"] == 5
    assert fragments_path.read_bytes() == online_fragments


def test_sha256_mismatch_is_clear_and_untrusted_download_is_removed(tmp_path: Path) -> None:
    docx = tmp_path / "remote" / "23501-i20.docx"
    _make_docx(docx)
    archive = tmp_path / "remote" / "23501-i20.zip"
    with zipfile.ZipFile(archive, "w") as package:
        package.write(docx, docx.name)
    (tmp_path / "config").mkdir()
    config = {
        "baseline": {"3gpp_release": 18, "release_code": "i"},
        "sources": [
            {
                "id": "bad-hash",
                "organization": "3GPP",
                "number": "23.501",
                "filename": archive.name,
                "download_url": archive.as_uri(),
                "sha256": "0" * 64,
                "extract": True,
            }
        ],
    }
    (tmp_path / "config" / "standards.json").write_text(
        json.dumps(config), encoding="utf-8"
    )

    with pytest.raises(SourceSyncError, match="SHA-256 mismatch"):
        run_pipeline(project_root=tmp_path, mode="download")
    assert not (tmp_path / "sources" / "downloads" / "bad-hash" / archive.name).exists()


def test_resolve_only_does_not_download(tmp_path: Path) -> None:
    archive = tmp_path / "remote" / "23501-i20.zip"
    archive.parent.mkdir()
    archive.write_bytes(b"not needed during resolution")
    (tmp_path / "config").mkdir()
    config = {
        "baseline": {"3gpp_release": 18, "release_code": "i"},
        "sources": [
            {
                "id": "3gpp-ts-23.501",
                "organization": "3GPP",
                "number": "23.501",
                "filename": archive.name,
                "download_url": archive.as_uri(),
                "sha256": "b" * 64,
                "extract": True,
            }
        ],
    }
    (tmp_path / "config" / "standards.json").write_text(
        json.dumps(config), encoding="utf-8"
    )

    summary = run_pipeline(project_root=tmp_path, mode="resolve")
    assert summary["mode"] == "resolve"
    assert not (tmp_path / "sources" / "downloads").exists()
    lock = json.loads((tmp_path / "sources" / "lock.json").read_text(encoding="utf-8"))
    assert lock["sources"][0]["sha256"] == "b" * 64


def test_cited_source_ids_scans_nested_evidence_only(tmp_path: Path) -> None:
    catalog = tmp_path / "catalog"
    catalog.mkdir()
    (catalog / "sample.json").write_text(
        json.dumps(
            {
                "concepts": [
                    {
                        "id": "x",
                        "evidence": [{"source": "source-a", "locator": "clause 1"}],
                    }
                ],
                "procedures": [
                    {
                        "steps": [
                            {
                                "evidence": [
                                    {"source": "source-b", "locator": "Figure 2"},
                                    {"source": "not-evidence"},
                                ]
                            }
                        ]
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    assert cited_source_ids(tmp_path) == {"source-a", "source-b"}


def test_cited_ietf_html_is_hashed_and_extracted(tmp_path: Path) -> None:
    remote = tmp_path / "remote-rfc.html"
    remote.write_text(
        "<html><body><h2>1. Introduction</h2><p>A protocol statement.</p>"
        "<script>hidden()</script></body></html>",
        encoding="utf-8",
    )
    (tmp_path / "config").mkdir()
    (tmp_path / "catalog").mkdir()
    (tmp_path / "config" / "standards.json").write_text(
        json.dumps(
            {
                "sources": [
                    {
                        "id": "ietf-rfc-test",
                        "organization": "IETF",
                        "document_type": "RFC",
                        "number": "RFC TEST",
                        "official_url": remote.as_uri(),
                        "extract": True,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "catalog" / "test.json").write_text(
        json.dumps(
            {
                "concepts": [
                    {
                        "id": "test",
                        "evidence": [
                            {"source": "ietf-rfc-test", "locator": "Section 1"}
                        ],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    summary = run_pipeline(project_root=tmp_path, mode="extract", cited_only=True)
    assert summary["selected_source_count"] == 1
    lock = json.loads((tmp_path / "sources" / "lock.json").read_text(encoding="utf-8"))
    source = lock["sources"][0]
    assert source["status"] == "downloaded-metadata"
    assert len(source["sha256"]) == 64
    fragments = _jsonl(tmp_path / "evidence" / "fragments.jsonl")
    assert len(fragments) == 1
    assert fragments[0]["source_id"] == "ietf-rfc-test"
    assert "A protocol statement." in fragments[0]["text"]
    assert "hidden()" not in fragments[0]["text"]


def test_fragment_index_scopes_duplicate_fragment_ids_by_source(tmp_path: Path) -> None:
    jsonl = tmp_path / "fragments.jsonl"
    alpha_hash = hashlib.sha256(b"Alpha registration statement").hexdigest()
    beta_hash = hashlib.sha256(b"Beta session statement").hexdigest()
    rows = [
        {
            "source_id": "source-a",
            "source_sha256": "c" * 64,
            "fragment_id": "same-id",
            "section_number": "4.2",
            "locator": "clause 4.2",
            "text": "Alpha registration statement",
            "content_hash": alpha_hash,
        },
        {
            "source_id": "source-b",
            "source_sha256": "d" * 64,
            "fragment_id": "same-id",
            "section_number": "4.2",
            "locator": "clause 4.2",
            "text": "Beta session statement",
            "content_hash": beta_hash,
        },
    ]
    jsonl.write_text(
        "".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8"
    )
    index_path = tmp_path / "fragments.sqlite"
    assert build_fragment_index(jsonl, index_path) == 2
    index = FragmentIndex(index_path)
    try:
        result = index.find(
            {"source": "source-b", "locator": "clause 4.2", "match": "Beta"}
        )
        assert result is not None
        assert result["content_hash"] == beta_hash
        assert result["source_sha256"] == "d" * 64
        assert (
            index.find(
                {
                    "source": "source-b",
                    "locator": "clause 9.9",
                    "fragment_id": "same-id",
                    "_require_locator_match": True,
                }
            )
            is None
        )
        explicit_fragment = index.find(
            {
                "source": "source-b",
                "locator": "fragment:same-id",
                "fragment_id": "same-id",
                "_require_locator_match": True,
            }
        )
        assert explicit_fragment is not None
        assert explicit_fragment["content_hash"] == beta_hash
        assert (
            index.find(
                {
                    "source": "source-b",
                    "locator": "Bogus Annex",
                    "fragment_id": "same-id",
                    "_require_locator_match": True,
                }
            )
            is None
        )
        assert (
            index.find(
                {
                    "source": "source-b",
                    "locator": "clause 4.2",
                    "match": "not present in the source",
                }
            )
            is None
        )
        quoted = index.find(
                {
                    "source": "source-b",
                    "locator": "Section 4.2 (Introduction)",
                "match": "semantic hint that is not verbatim",
                "quote": "Beta session statement",
            }
        )
        assert quoted is not None
        assert quoted["content_hash"] == beta_hash
        assert (
            index.find(
                {
                    "source": "source-b",
                    "locator": "Section 4.2 (Introduction)",
                    "quote": "beta session statement",
                }
            )
            is None
        )
    finally:
        index.close()
