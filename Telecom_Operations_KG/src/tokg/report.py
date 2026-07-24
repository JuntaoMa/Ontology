"""Generate transparent source, domain, catalog, and traceability coverage reports."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

from .build import DERIVED_STEP_ACTION_RULE
from .evidence_audit import audit as audit_evidence
from .model import TOKG, build_input_paths, concept_iri


REQUIRED_DOMAINS = ("4g", "5g", "ims", "transport", "service", "oam", "kpi-kqi")


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_checksums(path: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        digest, separator, name = line.partition("  ")
        if separator != "  " or len(digest) != 64 or not name or name in entries:
            raise ValueError(f"Invalid checksum line: {line!r}")
        entries[name] = digest
    return entries


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def _derived_step_action_ids(assertions: Iterable[dict[str, Any]]) -> set[str]:
    """Return catalog step IDs backed by a fully identified derived action assertion."""

    result: set[str] = set()
    for row in assertions:
        if (
            row.get("predicate") != str(TOKG.performsAction)
            or row.get("object_kind") != "iri"
            or row.get("status") != "proposed"
            or row.get("modality") != "derived"
            or row.get("derivation_rule") != DERIVED_STEP_ACTION_RULE
            or not row.get("evidence_ids")
        ):
            continue
        parents = row.get("derived_from", [])
        if not isinstance(parents, list) or len(parents) != 1:
            continue
        step_id = parents[0]
        if not isinstance(step_id, str) or not step_id:
            continue
        if (
            row.get("subject") == str(concept_iri(step_id))
            and row.get("object") == str(concept_iri(f"{step_id}/action"))
        ):
            result.add(step_id)
    return result


def _catalogs(root: Path) -> list[dict[str, Any]]:
    payloads = []
    for path in sorted((root / "catalog").glob("*.json")):
        payload = _read_json(path)
        payload["_file"] = path.name
        payloads.append(payload)
    return payloads


def _all_evidence(module: dict[str, Any]) -> Iterable[tuple[str, dict[str, Any]]]:
    for concept in module.get("concepts", []):
        for evidence in concept.get("evidence", []):
            yield f"concept:{concept.get('id')}", evidence
        for fact in concept.get("facts", []):
            for evidence in fact.get("evidence", concept.get("evidence", [])):
                yield f"fact:{concept.get('id')}:{fact.get('predicate')}", evidence
    for relation in module.get("relations", []):
        for evidence in relation.get("evidence", []):
            yield f"relation:{relation.get('subject')}:{relation.get('predicate')}", evidence
    for procedure in module.get("procedures", []):
        for evidence in procedure.get("evidence", []):
            yield f"procedure:{procedure.get('id')}", evidence
        for index, step in enumerate(procedure.get("steps", []), 1):
            for evidence in step.get("evidence", procedure.get("evidence", [])):
                yield f"step:{procedure.get('id')}:{index}", evidence
    for metric in module.get("metrics", []):
        for evidence in metric.get("evidence", []):
            yield f"metric:{metric.get('id')}", evidence


def generate_report(project_root: Path) -> dict[str, Any]:
    config = _read_json(project_root / "config" / "standards.json")
    lock_path = project_root / "sources" / "lock.json"
    lock = _read_json(lock_path) if lock_path.exists() else {"sources": []}
    configured = {source["id"]: source for source in config.get("sources", [])}
    locked = {source["id"]: source for source in lock.get("sources", [])}
    catalogs = _catalogs(project_root)
    release_assertions = _read_jsonl(
        project_root / "release" / "jsonl" / "assertions.jsonl"
    )
    derived_step_action_ids = _derived_step_action_ids(release_assertions)

    concepts_by_module: Counter[str] = Counter()
    procedures_by_module: Counter[str] = Counter()
    steps_by_module: Counter[str] = Counter()
    derived_step_actions_by_module: Counter[str] = Counter()
    metrics_by_module: Counter[str] = Counter()
    assertions_estimate_by_module: Counter[str] = Counter()
    used_sources: Counter[str] = Counter()
    gaps: list[dict[str, str]] = []

    for module in catalogs:
        name = module.get("module", module["_file"])
        concepts = module.get("concepts", [])
        procedures = module.get("procedures", [])
        metrics = module.get("metrics", [])
        concepts_by_module[name] += len(concepts)
        procedures_by_module[name] += len(procedures)
        steps_by_module[name] += sum(len(item.get("steps", [])) for item in procedures)
        metrics_by_module[name] += len(metrics)
        assertions_estimate_by_module[name] += (
            len(module.get("relations", []))
            + sum(2 + bool(item.get("notation")) + len(item.get("facts", [])) for item in concepts)
            + sum(2 + 5 * len(item.get("steps", [])) for item in procedures)
            + sum(3 + len(item.get("facts", [])) for item in metrics)
        )
        for concept in concepts:
            if not concept.get("evidence"):
                gaps.append({"kind": "concept-without-evidence", "item": concept.get("id", ""), "module": name})
        for relation in module.get("relations", []):
            if not relation.get("evidence"):
                gaps.append({"kind": "relation-without-evidence", "item": f"{relation.get('subject')}:{relation.get('predicate')}", "module": name})
        for procedure in procedures:
            if not procedure.get("evidence"):
                gaps.append({"kind": "procedure-without-evidence", "item": procedure.get("id", ""), "module": name})
            if not procedure.get("steps"):
                gaps.append({"kind": "procedure-without-steps", "item": procedure.get("id", ""), "module": name})
            for index, step in enumerate(procedure.get("steps", []), 1):
                if not step.get("evidence") and not procedure.get("evidence"):
                    gaps.append({"kind": "step-without-evidence", "item": f"{procedure.get('id')}:{index}", "module": name})
                if not step.get("message") and not step.get("action"):
                    step_id = step.get("id") or f"{procedure['id']}/step-{index:02d}"
                    if step_id in derived_step_action_ids:
                        derived_step_actions_by_module[name] += 1
                    else:
                        gaps.append({"kind": "step-without-message-or-action", "item": f"{procedure.get('id')}:{index}", "module": name})
        for metric in metrics:
            if not metric.get("evidence"):
                gaps.append({"kind": "metric-without-evidence", "item": metric.get("id", ""), "module": name})
        for item, evidence in _all_evidence(module):
            source_id = evidence.get("source")
            if source_id:
                used_sources[source_id] += 1
            if source_id not in configured:
                gaps.append({"kind": "unknown-evidence-source", "item": item, "module": name})
            if not evidence.get("locator"):
                gaps.append({"kind": "evidence-without-locator", "item": item, "module": name})
            organization = configured.get(source_id, {}).get("organization", "")
            if organization.upper() != "3GPP" and not evidence.get("quote"):
                gaps.append({"kind": "external-evidence-without-exact-quote", "item": item, "module": name})

    for source_id in used_sources:
        if source_id not in locked or not locked[source_id].get("sha256"):
            gaps.append({"kind": "cited-source-without-artifact-hash", "item": source_id, "module": "sources"})

    organizations = Counter(source.get("organization", "unknown") for source in configured.values())
    domains = Counter(
        domain
        for source in configured.values()
        for domain in source.get("domains", [])
    )
    source_status = Counter(source.get("status", "not-locked") for source in locked.values())
    domain_matrix = {
        domain: {
            "configured_sources": domains.get(domain, 0),
            "cited_sources": sum(
                1 for source_id in used_sources if domain in configured.get(source_id, {}).get("domains", [])
            ),
        }
        for domain in REQUIRED_DOMAINS
    }
    for domain, values in domain_matrix.items():
        if values["configured_sources"] == 0:
            gaps.append({"kind": "domain-without-source", "item": domain, "module": "sources"})
        if catalogs and values["cited_sources"] == 0:
            gaps.append({"kind": "domain-without-catalog-evidence", "item": domain, "module": "catalog"})

    validation_path = project_root / "release" / "validation-report.json"
    validation = _read_json(validation_path) if validation_path.exists() else None
    manifest_path = project_root / "release" / "manifest.json"
    manifest = _read_json(manifest_path) if manifest_path.exists() else None
    manifest_inputs_current = bool(manifest and manifest.get("inputs"))
    manifest_files_current = bool(manifest and manifest.get("files"))
    if manifest:
        current_inputs = {
            str(path.relative_to(project_root)) for path in build_input_paths(project_root)
        }
        if current_inputs != set(manifest.get("inputs", {})):
            manifest_inputs_current = False
        for relative, expected in manifest.get("inputs", {}).items():
            path = project_root / relative
            if not path.is_file() or _file_sha256(path) != expected:
                manifest_inputs_current = False
        for relative, expected in manifest.get("files", {}).items():
            path = project_root / "release" / relative
            if not path.is_file() or _file_sha256(path) != expected:
                manifest_files_current = False
    current_manifest_hash = _file_sha256(manifest_path) if manifest_path.exists() else ""
    checksums_current = False
    if manifest:
        checksum_path = project_root / "release" / str(
            manifest.get("checksum_file") or "checksums.sha256"
        )
        expected_checksums = {
            **manifest.get("files", {}),
            "manifest.json": current_manifest_hash,
        }
        try:
            checksums_current = (
                checksum_path.is_file()
                and _read_checksums(checksum_path) == expected_checksums
            )
        except (OSError, ValueError):
            checksums_current = False
        if not checksums_current:
            manifest_files_current = False
    dataset_path = project_root / "release" / "dataset.trig"
    current_dataset_hash = _file_sha256(dataset_path) if dataset_path.exists() else ""
    validation_current = bool(
        validation
        and manifest
        and manifest_inputs_current
        and manifest_files_current
        and validation.get("input_hashes_match")
        and validation.get("release_hashes_match")
        and validation.get("checksums_match")
        and validation.get("manifest_sha256") == current_manifest_hash
        and validation.get("dataset_sha256") == current_dataset_hash
    )
    if not manifest:
        gaps.append({"kind": "missing-build-manifest", "item": "release/manifest.json", "module": "release"})
    elif not manifest_inputs_current:
        gaps.append({"kind": "build-inputs-changed-after-build", "item": "release/manifest.json", "module": "release"})
    elif not manifest_files_current:
        gaps.append({"kind": "release-files-changed-after-build", "item": "release/manifest.json", "module": "release"})
    if not validation_current:
        gaps.append({"kind": "missing-or-stale-validation", "item": "release/validation-report.json", "module": "release"})
    try:
        evidence_audit = audit_evidence(project_root)
    except (FileNotFoundError, OSError, ValueError, sqlite3.DatabaseError) as exc:
        evidence_audit = {
            "conforms": False,
            "finding_count": 1,
            "unique_finding_count": 1,
            "warning_count": 0,
            "findings": [{"error": "evidence-audit-unavailable", "owner": str(exc), "module": "evidence"}],
            "warnings": [],
        }
    for finding in evidence_audit.get("findings", []):
        gaps.append(
            {
                "kind": f"evidence-audit:{finding.get('error', 'failure')}",
                "item": finding.get("owner") or finding.get("json_path", ""),
                "module": finding.get("module", "evidence"),
            }
        )
    for warning in evidence_audit.get("warnings", []):
        gaps.append(
            {
                "kind": f"evidence-audit:{warning.get('warning', 'warning')}",
                "item": warning.get("owner") or warning.get("json_path", ""),
                "module": warning.get("module", "evidence"),
            }
        )
    report = {
        "report_version": "1.2.0",
        "baseline": config.get("baseline", {}),
        "sources": {
            "configured": len(configured),
            "locked": len(locked),
            "hashed_artifacts": sum(bool(item.get("sha256")) for item in locked.values()),
            "cited": len(used_sources),
            "by_organization": dict(sorted(organizations.items())),
            "by_status": dict(sorted(source_status.items())),
            "cited_details": [
                {
                    "id": source_id,
                    "organization": configured.get(source_id, {}).get("organization", ""),
                    "number": configured.get(source_id, {}).get("number", ""),
                    "version": locked.get(source_id, {}).get("version"),
                    "release": locked.get(source_id, {}).get("release"),
                    "status": locked.get(source_id, {}).get("status", "not-locked"),
                    "sha256": locked.get(source_id, {}).get("sha256"),
                    "official_url": locked.get(source_id, {}).get("official_url")
                    or configured.get(source_id, {}).get("official_url", ""),
                    "artifact_url": locked.get(source_id, {}).get("artifact_url")
                    or locked.get(source_id, {}).get("download_url", ""),
                    "evidence_references": used_sources[source_id],
                }
                for source_id in sorted(used_sources)
            ],
        },
        "domains": domain_matrix,
        "catalog": {
            "modules": len(catalogs),
            "concepts_by_module": dict(concepts_by_module),
            "procedures_by_module": dict(procedures_by_module),
            "steps_by_module": dict(steps_by_module),
            "derived_step_actions_by_module": dict(derived_step_actions_by_module),
            "metrics_by_module": dict(metrics_by_module),
            "estimated_assertions_by_module": dict(assertions_estimate_by_module),
            "evidence_references": sum(used_sources.values()),
        },
        "release_statistics": manifest.get("statistics") if manifest else None,
        "validation": {
            "available": validation is not None,
            "conforms": validation.get("conforms") if validation else None,
            "current": validation_current,
            "warnings": len(validation.get("warnings", [])) if validation else None,
        },
        "evidence_audit": {
            key: value
            for key, value in evidence_audit.items()
            if key not in {"findings", "warnings"}
        },
        "gaps": gaps,
        "publishable": bool(
            validation
            and validation.get("conforms")
            and validation_current
            and not gaps
        ),
        "completeness_rule": (
            "Publishable only when every configured domain has evidence, every cited artifact is "
            "hashed, every procedure has steps, every accepted assertion is traceable, no recorded "
            "gap or evidence-audit warning remains, and SHACL/custom validation conforms."
        ),
    }
    reports_dir = project_root / "reports"
    reports_dir.mkdir(exist_ok=True)
    (reports_dir / "coverage.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (reports_dir / "COVERAGE.md").write_text(_markdown(report), encoding="utf-8")
    (reports_dir / "SOURCE_LOCK.md").write_text(
        _source_lock_markdown(report), encoding="utf-8"
    )
    return report


def _markdown(report: dict[str, Any]) -> str:
    source = report["sources"]
    catalog = report["catalog"]
    lines = [
        "# 电信运维知识图谱覆盖与完整性报告",
        "",
        "> “完整”仅相对于本报告锁定的公开标准语料基线；未通过校验时不得标记为可发布。",
        "",
        "## 总览",
        "",
        f"- 配置来源：{source['configured']}；已锁定：{source['locked']}；已哈希工件：{source['hashed_artifacts']}；实际引用：{source['cited']}。",
        f"- 目录模块：{catalog['modules']}；证据引用：{catalog['evidence_references']}。",
        f"- 严格证据审计：{report['evidence_audit'].get('unique_finding_count', 0)} 个唯一失败；{report['evidence_audit'].get('warning_count', 0)} 个警告。",
        f"- 发布条件：{'满足' if report['publishable'] else '未满足'}。",
        "",
        "## 领域来源覆盖",
        "",
        "| 领域 | 配置来源 | 已被目录引用 |",
        "|---|---:|---:|",
    ]
    for domain, values in report["domains"].items():
        lines.append(f"| {domain} | {values['configured_sources']} | {values['cited_sources']} |")
    lines.extend(
        [
            "",
            "## 目录覆盖",
            "",
            "| 模块 | 概念 | 流程 | 步骤 | 派生步骤动作 | 指标 | 估算断言 |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ]
    )
    modules = sorted(
        set(catalog["concepts_by_module"])
        | set(catalog["procedures_by_module"])
        | set(catalog["derived_step_actions_by_module"])
        | set(catalog["metrics_by_module"])
    )
    for module in modules:
        lines.append(
            "| {0} | {1} | {2} | {3} | {4} | {5} | {6} |".format(
                module,
                catalog["concepts_by_module"].get(module, 0),
                catalog["procedures_by_module"].get(module, 0),
                catalog["steps_by_module"].get(module, 0),
                catalog["derived_step_actions_by_module"].get(module, 0),
                catalog["metrics_by_module"].get(module, 0),
                catalog["estimated_assertions_by_module"].get(module, 0),
            )
        )
    lines.extend(["", "## 未闭合项", ""])
    if report["gaps"]:
        for gap in report["gaps"]:
            lines.append(f"- `{gap['kind']}`：`{gap['item']}`（{gap['module']}）")
    else:
        lines.append("无。")
    lines.extend(["", "## 发布判定规则", "", report["completeness_rule"], ""])
    return "\n".join(lines)


def _source_lock_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# 实际引用来源与制品锁",
        "",
        "> 每一行对应目录中实际引用的公开规范；SHA-256 为空即表示证据链尚未闭合。",
        "",
        "| 来源ID | 机构 | 规范 | 版本/版次 | 状态 | 证据引用 | SHA-256 | 官方落地页 | 制品 |",
        "|---|---|---|---|---|---:|---|---|---|",
    ]
    for item in report["sources"]["cited_details"]:
        version = item.get("version") or item.get("release") or ""
        digest = item.get("sha256") or ""
        landing = f"[链接]({item['official_url']})" if item.get("official_url") else ""
        artifact = f"[制品]({item['artifact_url']})" if item.get("artifact_url") else ""
        lines.append(
            f"| `{item['id']}` | {item['organization']} | {item['number']} | {version} | "
            f"{item['status']} | {item['evidence_references']} | `{digest}` | {landing} | {artifact} |"
        )
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    report = generate_report(args.project_root.resolve())
    print(json.dumps({"publishable": report["publishable"], "gaps": len(report["gaps"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
