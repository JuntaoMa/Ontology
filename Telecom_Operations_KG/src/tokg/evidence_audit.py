"""Audit every catalog evidence selector against the locked source fragments."""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
from typing import Any, Iterator

from .fragment_index import FragmentIndex
from .model import load_catalogs, load_sources


def _walk(
    value: Any,
    path: str = "$",
    owner: str = "",
) -> Iterator[tuple[str, str, dict[str, Any]]]:
    if isinstance(value, dict):
        current_owner = str(value.get("id") or owner)
        if isinstance(value.get("source"), str) and "locator" in value:
            yield path, current_owner, value
        for key, child in value.items():
            yield from _walk(child, f"{path}.{key}", current_owner)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _walk(child, f"{path}[{index}]", owner)


def _normalized(value: Any) -> str:
    return " ".join(str(value or "").split())


def audit(project_root: Path) -> dict[str, Any]:
    sources = load_sources(project_root)
    index = FragmentIndex(project_root / "evidence" / "fragments.sqlite")
    index.verify_jsonl(project_root / "evidence" / "fragments.jsonl")
    findings: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    checked = 0
    unique_selectors: set[tuple[str, str, str, str, str]] = set()
    try:
        for catalog in load_catalogs(project_root):
            catalog_path = Path(catalog["_path"])
            module = str(catalog.get("module") or catalog_path.stem)
            for json_path, owner, record in _walk(catalog):
                checked += 1
                source_id = str(record.get("source") or "")
                locator = str(record.get("locator") or "").strip()
                match = str(record.get("match") or "").strip()
                quote = str(record.get("quote") or "").strip()
                fragment_id = str(record.get("fragment_id") or "").strip()
                unique_selectors.add((source_id, locator, match, quote, fragment_id))
                error = ""
                source = sources.get(source_id)
                fragment: dict[str, Any] | None = None
                if source is None:
                    error = "unknown-source"
                elif not source.sha256:
                    error = "unhashed-source"
                elif not locator:
                    error = "missing-locator"
                elif source.organization.upper() != "3GPP" and not quote:
                    error = "external-source-requires-exact-quote"
                else:
                    fragment = index.find(
                        {
                            **record,
                            "_require_locator_match": source.organization.upper() == "3GPP",
                        }
                    )
                    if fragment is None:
                        error = "selector-not-found"
                    elif str(fragment.get("source_sha256") or "") != source.sha256:
                        error = "fragment-artifact-hash-mismatch"
                    elif quote and _normalized(quote) not in _normalized(fragment.get("text")):
                        error = "exact-quote-not-found"
                if error:
                    findings.append(
                        {
                            "error": error,
                            "catalog": str(catalog_path.relative_to(project_root)),
                            "module": module,
                            "json_path": json_path,
                            "owner": owner,
                            "source": source_id,
                            "locator": locator,
                            "match": match,
                            "quote": quote,
                            "fragment_id": fragment_id,
                        }
                    )
                elif not (match or quote or fragment_id):
                    warnings.append(
                        {
                            "warning": "locator-only-3gpp-evidence",
                            "catalog": str(catalog_path.relative_to(project_root)),
                            "module": module,
                            "json_path": json_path,
                            "owner": owner,
                            "source": source_id,
                            "locator": locator,
                            "resolved_fragment_id": str((fragment or {}).get("fragment_id") or ""),
                        }
                    )
    finally:
        index.close()

    by_error = Counter(row["error"] for row in findings)
    by_module = Counter(row["module"] for row in findings)
    finding_selector_keys = {
        (
            row["source"],
            row["locator"],
            row["match"],
            row["quote"],
            row["fragment_id"],
        )
        for row in findings
    }
    unique_by_module = {
        module: len(
            {
                (
                    row["source"],
                    row["locator"],
                    row["match"],
                    row["quote"],
                    row["fragment_id"],
                )
                for row in findings
                if row["module"] == module
            }
        )
        for module in sorted(by_module)
    }
    warning_selector_keys = {
        (row["source"], row["locator"], row["resolved_fragment_id"])
        for row in warnings
    }
    unique_warnings_by_module = {
        module: len(
            {
                (row["source"], row["locator"], row["resolved_fragment_id"])
                for row in warnings
                if row["module"] == module
            }
        )
        for module in sorted({row["module"] for row in warnings})
    }
    return {
        "conforms": not findings and not warnings,
        "checked_evidence_references": checked,
        "unique_evidence_selectors": len(unique_selectors),
        "finding_count": len(findings),
        "unique_finding_count": len(finding_selector_keys),
        "warning_count": len(warnings),
        "unique_warning_count": len(warning_selector_keys),
        "findings_by_error": dict(sorted(by_error.items())),
        "findings_by_module": dict(sorted(by_module.items())),
        "unique_findings_by_module": unique_by_module,
        "unique_warnings_by_module": unique_warnings_by_module,
        "findings": findings,
        "warnings": warnings,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = args.project_root.resolve()
    result = audit(root)
    output = args.output or root / "reports" / "evidence-audit.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {key: value for key, value in result.items() if key not in {"findings", "warnings"}},
            ensure_ascii=False,
        )
    )
    raise SystemExit(0 if result["conforms"] else 1)


if __name__ == "__main__":
    main()
