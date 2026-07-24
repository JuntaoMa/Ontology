"""Validate graph structure, SHACL conformance, traceability, and coverage."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any

from pyshacl import validate as shacl_validate
from rdflib import Dataset, Graph, Literal, URIRef
from rdflib.namespace import RDF, RDFS, SH, XSD
from rdflib.term import Identifier

from .model import TOKG, TOKG_ID, CatalogError, build_input_paths, load_sources


_EXPECTED_SPARQL_CONSTRAINTS = 19
_EXPECTED_SPARQL_SIGNATURE_SHA256 = (
    "bba8410d2293df16ad796a02a5817d9cc8ff63ec2e92ce567b02455d94d8f822"
)
_SPARQL_RULE_MESSAGES = {
    "baseline-duplicate-main-edition": (
        "A baseline may select only one main edition for each document family."
    ),
    "baseline-item-edition-family": (
        "A baseline item selectedEdition must be an edition of its documentFamily."
    ),
    "dependency-self-reference": "A dependency cannot point to itself.",
    "document-edition-self-predecessor": "An edition cannot be its own predecessor.",
    "evidence-char-order": "Evidence startChar must be smaller than endChar.",
    "evidence-char-pair": "startChar and endChar must occur together.",
    "evidence-exact-quote-hash": "An exact quote requires its exact-text SHA-256.",
    "evidence-inferred-derivation": (
        "Inferred evidence requires a derivation rule on its assertion."
    ),
    "evidence-link-backreference": (
        "An assertion-evidence link must be referenced by its declared assertion."
    ),
    "assertion-derived-derivation": (
        "Derived or inferred assertions require a derivation rule."
    ),
    "assertion-reviewed-support": (
        "Reviewed or accepted assertions require supporting evidence."
    ),
    "flow-edge-procedure": "A flow edge must connect steps in the same procedure variant.",
    "ie-conditional-condition": "Conditional IE usage requires an explicit condition.",
    "ie-mandatory-min-occurs": "Mandatory IE usage requires minOccurs of at least one.",
    "ie-min-max-order": "minOccurs cannot exceed maxOccurs.",
    "message-exchange-loopback": (
        "Sender and receiver must differ unless loopbackAllowed is true."
    ),
    "message-exchange-protocol-binding": (
        "The exchange message protocol must be bound to the selected interface."
    ),
    "procedure-step-index-unique": (
        "stepIndex must be unique inside a procedure variant."
    ),
    "procedure-step-key-unique": "stepKey must be unique inside a procedure variant.",
}

_SPARQL_RULE_SHAPES = {
    "baseline-duplicate-main-edition": TOKG.BaselineShape,
    "baseline-item-edition-family": TOKG.BaselineItemShape,
    "dependency-self-reference": TOKG.DependencyShape,
    "document-edition-self-predecessor": TOKG.DocumentEditionShape,
    "evidence-char-order": TOKG.EvidenceSpanShape,
    "evidence-char-pair": TOKG.EvidenceSpanShape,
    "evidence-exact-quote-hash": TOKG.EvidenceSpanShape,
    "evidence-inferred-derivation": TOKG.AssertionEvidenceShape,
    "evidence-link-backreference": TOKG.AssertionEvidenceShape,
    "assertion-derived-derivation": TOKG.AssertionShape,
    "assertion-reviewed-support": TOKG.AssertionShape,
    "flow-edge-procedure": TOKG.FlowEdgeShape,
    "ie-conditional-condition": TOKG.IEUsageShape,
    "ie-mandatory-min-occurs": TOKG.IEUsageShape,
    "ie-min-max-order": TOKG.IEUsageShape,
    "message-exchange-loopback": TOKG.MessageExchangeShape,
    "message-exchange-protocol-binding": TOKG.MessageExchangeShape,
    "procedure-step-index-unique": TOKG.ProcedureStepShape,
    "procedure-step-key-unique": TOKG.ProcedureStepShape,
}

_SHACL_TARGET_PREDICATES = frozenset(
    {
        RDF.type,
        SH.targetClass,
        SH.targetNode,
        SH.targetSubjectsOf,
        SH.targetObjectsOf,
        SH.target,
        SH.deactivated,
        SH.severity,
    }
)


@dataclass(frozen=True)
class _SparqlViolation:
    rule: str
    focus: Identifier

    @property
    def message(self) -> str:
        return _SPARQL_RULE_MESSAGES[self.rule]

    def format(self) -> str:
        return f"SHACL-SPARQL[{self.rule}] focus={self.focus}: {self.message}"

_INDEXED_PREDICATES = frozenset(
    {
        TOKG.predecessorEdition,
        TOKG.startChar,
        TOKG.endChar,
        TOKG.exactQuote,
        TOKG.exactTextSha256,
        TOKG.assertionStatus,
        TOKG.hasAssertionEvidence,
        TOKG.forAssertion,
        TOKG.evidenceRole,
        TOKG.assertionModality,
        TOKG.derivationRule,
        TOKG.evidenceDirectness,
        TOKG.inProcedure,
        TOKG.stepIndex,
        TOKG.stepKey,
        TOKG.fromStep,
        TOKG.toStep,
        TOKG.senderRole,
        TOKG.receiverRole,
        TOKG.loopbackAllowed,
        TOKG.exchangeMessage,
        TOKG.overInterface,
        TOKG.definedByProtocol,
        TOKG.hasProtocolBinding,
        TOKG.bindsProtocol,
        TOKG.minOccurs,
        TOKG.maxOccurs,
        TOKG.presence,
        TOKG.usageCondition,
        TOKG.dependencySource,
        TOKG.dependencyTarget,
        TOKG.hasBaselineItem,
        TOKG.documentFamily,
        TOKG.inclusionType,
        TOKG.selectedEdition,
        TOKG.editionOf,
    }
)


def _core_shapes_without_sparql(shapes: Graph) -> tuple[Graph, int]:
    """Copy a shapes graph and detach its runtime SHACL-SPARQL constraints."""

    core_shapes = Graph()
    for prefix, namespace in shapes.namespaces():
        core_shapes.bind(prefix, namespace, replace=True)
    for triple in shapes:
        core_shapes.add(triple)
    attachments = list(core_shapes.triples((None, SH.sparql, None)))
    for triple in attachments:
        core_shapes.remove(triple)
    return core_shapes, len(attachments)


def _sparql_constraint_signature(shapes: Graph) -> str:
    """Bind the optimized rules to the exact source SHACL-SPARQL definitions."""

    records: list[dict[str, Any]] = []
    for shape, constraint in shapes.subject_objects(SH.sparql):
        targets = sorted(
            (str(predicate), obj.n3())
            for predicate, obj in shapes.predicate_objects(shape)
            if predicate in _SHACL_TARGET_PREDICATES
        )
        constraint_properties = sorted(
            (str(predicate), obj.n3())
            for predicate, obj in shapes.predicate_objects(constraint)
        )
        records.append(
            {
                "shape": shape.n3(),
                "targets": targets,
                "constraint": constraint_properties,
            }
        )
    payload = json.dumps(
        sorted(records, key=lambda record: json.dumps(record, sort_keys=True)),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _numeric_value(term: Identifier) -> Decimal | None:
    if not isinstance(term, Literal):
        return None
    value = term.toPython()
    if isinstance(value, bool) or not isinstance(value, (Decimal, int, float)):
        return None
    try:
        numeric = Decimal(str(value))
    except (ArithmeticError, ValueError):
        return None
    return numeric if numeric.is_finite() else None


def _is_normative_inclusion(term: Identifier) -> bool:
    """Match SPARQL value equality with the plain literal ``"normative"``."""

    return (
        isinstance(term, Literal)
        and term.language is None
        and term.datatype in {None, XSD.string}
        and str(term) == "normative"
    )


def _find_sparql_violations(graph: Graph) -> list[_SparqlViolation]:
    """Evaluate the 19 SHACL-SPARQL rules from ``tokg-shapes.ttl`` in one scan.

    pySHACL remains responsible for every SHACL Core constraint.  This function
    indexes only the predicates used by the SPARQL rules, avoiding one full-graph
    SPARQL query per focus node while retaining each rule's focus-node semantics.
    """

    values: dict[URIRef, dict[Identifier, set[Identifier]]] = {
        predicate: defaultdict(set) for predicate in _INDEXED_PREDICATES
    }
    instances: dict[Identifier, set[Identifier]] = defaultdict(set)
    subclasses: dict[Identifier, set[Identifier]] = defaultdict(set)
    for subject, predicate, obj in graph:
        if predicate == RDF.type:
            instances[obj].add(subject)
        elif predicate == RDFS.subClassOf:
            subclasses[obj].add(subject)
        predicate_values = values.get(predicate)
        if predicate_values is not None:
            predicate_values[subject].add(obj)

    target_cache: dict[Identifier, set[Identifier]] = {}

    def targets(target_class: Identifier) -> set[Identifier]:
        cached = target_cache.get(target_class)
        if cached is not None:
            return cached
        descendant_classes = {target_class}
        pending = [target_class]
        while pending:
            parent = pending.pop()
            for child in subclasses.get(parent, ()):
                if child not in descendant_classes:
                    descendant_classes.add(child)
                    pending.append(child)
        result = {
            node
            for class_iri in descendant_classes
            for node in instances.get(class_iri, ())
        }
        target_cache[target_class] = result
        return result

    def objects(subject: Identifier, predicate: URIRef) -> set[Identifier]:
        return values[predicate].get(subject, set())

    violations: dict[tuple[str, str], _SparqlViolation] = {}

    def add(rule: str, focus: Identifier) -> None:
        violations[(rule, str(focus))] = _SparqlViolation(rule=rule, focus=focus)

    for edition in targets(TOKG.DocumentEdition):
        if edition in objects(edition, TOKG.predecessorEdition):
            add("document-edition-self-predecessor", edition)

    for evidence in targets(TOKG.EvidenceSpan):
        starts = objects(evidence, TOKG.startChar)
        ends = objects(evidence, TOKG.endChar)
        if bool(starts) != bool(ends):
            add("evidence-char-pair", evidence)
        if any(
            start_value is not None
            and end_value is not None
            and start_value >= end_value
            for start in starts
            for end in ends
            for start_value, end_value in [(_numeric_value(start), _numeric_value(end))]
        ):
            add("evidence-char-order", evidence)
        if objects(evidence, TOKG.exactQuote) and not objects(evidence, TOKG.exactTextSha256):
            add("evidence-exact-quote-hash", evidence)

    reviewed_statuses = {
        TOKG_ID["assertion-status-reviewed"],
        TOKG_ID["assertion-status-accepted"],
    }
    derived_modalities = {
        TOKG_ID["assertion-modality-derived"],
        TOKG_ID["assertion-modality-inferred"],
    }
    support_role = TOKG_ID["evidence-role-supports"]
    for assertion in targets(TOKG.Assertion):
        if objects(assertion, TOKG.assertionStatus) & reviewed_statuses:
            has_support = any(
                assertion in objects(link, TOKG.forAssertion)
                and support_role in objects(link, TOKG.evidenceRole)
                for link in objects(assertion, TOKG.hasAssertionEvidence)
            )
            if not has_support:
                add("assertion-reviewed-support", assertion)
        if (
            objects(assertion, TOKG.assertionModality) & derived_modalities
            and not objects(assertion, TOKG.derivationRule)
        ):
            add("assertion-derived-derivation", assertion)

    inferred_directness = TOKG_ID["evidence-inferred"]
    for link in targets(TOKG.AssertionEvidence):
        linked_assertions = objects(link, TOKG.forAssertion)
        if any(link not in objects(assertion, TOKG.hasAssertionEvidence) for assertion in linked_assertions):
            add("evidence-link-backreference", link)
        if inferred_directness in objects(link, TOKG.evidenceDirectness) and any(
            not objects(assertion, TOKG.derivationRule) for assertion in linked_assertions
        ):
            add("evidence-inferred-derivation", link)

    steps_by_index: dict[tuple[Identifier, Identifier], set[Identifier]] = defaultdict(set)
    steps_by_key: dict[tuple[Identifier, Identifier], set[Identifier]] = defaultdict(set)
    for step, procedures in values[TOKG.inProcedure].items():
        for procedure in procedures:
            for index in objects(step, TOKG.stepIndex):
                steps_by_index[(procedure, index)].add(step)
            for key in objects(step, TOKG.stepKey):
                steps_by_key[(procedure, key)].add(step)
    for step in targets(TOKG.ProcedureStep):
        if any(
            len(steps_by_index[(procedure, index)]) > 1
            for procedure in objects(step, TOKG.inProcedure)
            for index in objects(step, TOKG.stepIndex)
        ):
            add("procedure-step-index-unique", step)
        if any(
            len(steps_by_key[(procedure, key)]) > 1
            for procedure in objects(step, TOKG.inProcedure)
            for key in objects(step, TOKG.stepKey)
        ):
            add("procedure-step-key-unique", step)

    for edge in targets(TOKG.FlowEdge):
        if any(
            left_procedure != right_procedure
            for left in objects(edge, TOKG.fromStep)
            for right in objects(edge, TOKG.toStep)
            for left_procedure in objects(left, TOKG.inProcedure)
            for right_procedure in objects(right, TOKG.inProcedure)
        ):
            add("flow-edge-procedure", edge)

    for exchange in targets(TOKG.MessageExchange):
        if (
            objects(exchange, TOKG.senderRole) & objects(exchange, TOKG.receiverRole)
            and Literal(True) not in objects(exchange, TOKG.loopbackAllowed)
        ):
            add("message-exchange-loopback", exchange)
        protocol_missing = any(
            not any(
                protocol in objects(binding, TOKG.bindsProtocol)
                for binding in objects(interface, TOKG.hasProtocolBinding)
            )
            for message in objects(exchange, TOKG.exchangeMessage)
            for interface in objects(exchange, TOKG.overInterface)
            for protocol in objects(message, TOKG.definedByProtocol)
        )
        if protocol_missing:
            add("message-exchange-protocol-binding", exchange)

    mandatory_presence = TOKG_ID["presence-mandatory"]
    conditional_presences = {
        TOKG_ID["presence-conditional"],
        TOKG_ID["presence-conditional-optional"],
    }
    for usage in targets(TOKG.IEUsage):
        minimums = objects(usage, TOKG.minOccurs)
        maximums = objects(usage, TOKG.maxOccurs)
        if any(
            minimum_value is not None
            and maximum_value is not None
            and minimum_value > maximum_value
            for minimum in minimums
            for maximum in maximums
            for minimum_value, maximum_value in [
                (_numeric_value(minimum), _numeric_value(maximum))
            ]
        ):
            add("ie-min-max-order", usage)
        if mandatory_presence in objects(usage, TOKG.presence) and any(
            minimum_value is not None and minimum_value < 1
            for minimum in minimums
            for minimum_value in [_numeric_value(minimum)]
        ):
            add("ie-mandatory-min-occurs", usage)
        if (
            objects(usage, TOKG.presence) & conditional_presences
            and not objects(usage, TOKG.usageCondition)
        ):
            add("ie-conditional-condition", usage)

    for dependency in targets(TOKG.Dependency):
        if objects(dependency, TOKG.dependencySource) & objects(
            dependency, TOKG.dependencyTarget
        ):
            add("dependency-self-reference", dependency)

    for baseline in targets(TOKG.Baseline):
        main_items_by_family: dict[Identifier, set[Identifier]] = defaultdict(set)
        for item in objects(baseline, TOKG.hasBaselineItem):
            inclusion_types = objects(item, TOKG.inclusionType)
            is_main = not any(
                not _is_normative_inclusion(inclusion) for inclusion in inclusion_types
            )
            if is_main:
                for family in objects(item, TOKG.documentFamily):
                    main_items_by_family[family].add(item)
        if any(len(items) > 1 for items in main_items_by_family.values()):
            add("baseline-duplicate-main-edition", baseline)

    for item in targets(TOKG.BaselineItem):
        if any(
            family not in objects(edition, TOKG.editionOf)
            for family in objects(item, TOKG.documentFamily)
            for edition in objects(item, TOKG.selectedEdition)
        ):
            add("baseline-item-edition-family", item)

    return [violations[key] for key in sorted(violations)]


def _validate_sparql_constraints(graph: Graph) -> list[str]:
    """Compatibility wrapper returning deterministic human-readable errors."""

    return [violation.format() for violation in _find_sparql_violations(graph)]


def _merge_sparql_validation_results(
    report_graph: Graph,
    *,
    core_conforms: bool,
    violations: list[_SparqlViolation],
    guard_errors: list[str],
) -> bool:
    """Merge optimized SPARQL results into the standard SHACL report graph."""

    report_nodes = list(report_graph.subjects(RDF.type, SH.ValidationReport))
    if len(report_nodes) != 1:
        raise CatalogError(
            "pySHACL returned an invalid validation report: expected one ValidationReport"
        )
    report_node = report_nodes[0]
    combined_conforms = bool(core_conforms) and not violations and not guard_errors
    report_graph.remove((report_node, SH.conforms, None))
    report_graph.add((report_node, SH.conforms, Literal(combined_conforms)))

    for violation in violations:
        digest = hashlib.sha256(
            f"{violation.rule}\u0000{violation.focus}".encode("utf-8")
        ).hexdigest()
        result_node = URIRef(f"urn:tokg:validation-result:sha256:{digest}")
        report_graph.add((report_node, SH.result, result_node))
        report_graph.add((result_node, RDF.type, SH.ValidationResult))
        report_graph.add((result_node, SH.focusNode, violation.focus))
        report_graph.add((result_node, SH.resultSeverity, SH.Violation))
        report_graph.add(
            (result_node, SH.sourceConstraintComponent, SH.SPARQLConstraintComponent)
        )
        report_graph.add(
            (result_node, SH.sourceShape, _SPARQL_RULE_SHAPES[violation.rule])
        )
        report_graph.add((result_node, SH.resultMessage, Literal(violation.message, lang="en")))

    for index, message in enumerate(guard_errors):
        digest = hashlib.sha256(f"guard\u0000{index}\u0000{message}".encode("utf-8")).hexdigest()
        result_node = URIRef(f"urn:tokg:validation-result:sha256:{digest}")
        report_graph.add((report_node, SH.result, result_node))
        report_graph.add((result_node, RDF.type, SH.ValidationResult))
        report_graph.add((result_node, SH.focusNode, URIRef("https://example.org/tokg/shapes")))
        report_graph.add((result_node, SH.resultSeverity, SH.Violation))
        report_graph.add(
            (result_node, SH.sourceConstraintComponent, SH.SPARQLConstraintComponent)
        )
        report_graph.add(
            (result_node, SH.sourceShape, URIRef("https://example.org/tokg/shapes"))
        )
        report_graph.add((result_node, SH.resultMessage, Literal(message)))
    return combined_conforms


def _combined_shacl_report_text(
    core_report_text: str,
    *,
    combined_conforms: bool,
    violations: list[_SparqlViolation],
    guard_errors: list[str],
) -> str:
    if not violations and not guard_errors:
        return core_report_text
    lines = core_report_text.rstrip().splitlines()
    for index, line in enumerate(lines):
        if line.startswith("Conforms:"):
            lines[index] = f"Conforms: {combined_conforms}"
            break
    lines.extend(["", "Optimized SHACL-SPARQL validation results:"])
    lines.extend(f"- {violation.format()}" for violation in violations)
    lines.extend(f"- {message}" for message in guard_errors)
    return "\n".join(lines) + "\n"


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
            raise ValueError(f"Invalid checksum line in {path}: {line!r}")
        entries[name] = digest
    return entries


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def validate_release(project_root: Path) -> dict[str, Any]:
    release_dir = project_root / "release"
    dataset_path = release_dir / "dataset.trig"
    manifest_path = release_dir / "manifest.json"
    shapes_path = project_root / "shapes" / "tokg-shapes.ttl"
    if not dataset_path.exists():
        raise CatalogError("release/dataset.trig is missing; run tokg-build first")
    if not shapes_path.exists():
        raise CatalogError("shapes/tokg-shapes.ttl is missing")
    if not manifest_path.exists():
        raise CatalogError("release/manifest.json is missing; run tokg-build first")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    warnings: list[str] = []
    if not manifest.get("inputs"):
        errors.append("Build manifest has no input hashes")
    if not manifest.get("files"):
        errors.append("Build manifest has no release file hashes")
    current_inputs = {
        str(path.relative_to(project_root)) for path in build_input_paths(project_root)
    }
    input_inventory_match = current_inputs == set(manifest.get("inputs", {}))
    if not input_inventory_match:
        errors.append("Build input inventory changed after the manifest was generated")
    input_hashes_match = input_inventory_match
    for relative, expected in manifest.get("inputs", {}).items():
        path = project_root / relative
        actual = _file_sha256(path) if path.is_file() else "missing"
        if actual != expected:
            input_hashes_match = False
            errors.append(f"Build input changed or is missing: {relative}")
    release_hashes_match = True
    for relative, expected in manifest.get("files", {}).items():
        path = release_dir / relative
        actual = _file_sha256(path) if path.is_file() else "missing"
        if actual != expected:
            release_hashes_match = False
            errors.append(f"Release file changed or is missing: {relative}")
    checksum_path = release_dir / str(manifest.get("checksum_file") or "checksums.sha256")
    expected_checksums = {
        **manifest.get("files", {}),
        "manifest.json": _file_sha256(manifest_path),
    }
    try:
        checksums_match = checksum_path.is_file() and _read_checksums(checksum_path) == expected_checksums
    except (OSError, ValueError):
        checksums_match = False
    if not checksums_match:
        errors.append("release/checksums.sha256 is missing, stale, or invalid")

    dataset = Dataset()
    dataset.parse(dataset_path, format="trig")
    union = Graph()
    for graph in dataset.graphs():
        for triple in graph:
            union.add(triple)
    shapes = Graph().parse(shapes_path, format="turtle")
    core_shapes, sparql_constraint_count = _core_shapes_without_sparql(shapes)
    sparql_constraint_signature = _sparql_constraint_signature(shapes)
    sparql_guard_errors: list[str] = []
    if sparql_constraint_count != _EXPECTED_SPARQL_CONSTRAINTS:
        sparql_guard_errors.append(
            "SHACL-SPARQL replacement coverage drift: "
            f"expected {_EXPECTED_SPARQL_CONSTRAINTS} constraints, "
            f"found {sparql_constraint_count}"
        )
    if sparql_constraint_signature != _EXPECTED_SPARQL_SIGNATURE_SHA256:
        sparql_guard_errors.append(
            "SHACL-SPARQL replacement signature drift: "
            f"expected {_EXPECTED_SPARQL_SIGNATURE_SHA256}, "
            f"found {sparql_constraint_signature}"
        )
    errors.extend(sparql_guard_errors)
    core_conforms, report_graph, core_report_text = shacl_validate(
        union,
        shacl_graph=core_shapes,
        inference="rdfs",
        inplace=True,
        abort_on_first=False,
        allow_infos=True,
        allow_warnings=True,
    )
    sparql_violations = _find_sparql_violations(union)
    sparql_errors = [violation.format() for violation in sparql_violations]
    errors.extend(sparql_errors)
    combined_shacl_conforms = _merge_sparql_validation_results(
        report_graph,
        core_conforms=bool(core_conforms),
        violations=sparql_violations,
        guard_errors=sparql_guard_errors,
    )
    report_text = _combined_shacl_report_text(
        core_report_text,
        combined_conforms=combined_shacl_conforms,
        violations=sparql_violations,
        guard_errors=sparql_guard_errors,
    )

    assertions = _load_jsonl(release_dir / "jsonl" / "assertions.jsonl")
    evidence = _load_jsonl(release_dir / "jsonl" / "evidence_spans.jsonl")
    entities = _load_jsonl(release_dir / "jsonl" / "entities.jsonl")
    sources = load_sources(project_root)
    evidence_ids = {row["id"] for row in evidence}
    for row in assertions:
        linked = row.get("evidence_ids", [])
        if row.get("status") in {"accepted", "reviewed"} and not linked:
            errors.append(f"Accepted assertion has no evidence: {row['id']}")
        missing = sorted(set(linked) - evidence_ids)
        if missing:
            errors.append(f"Assertion links missing evidence {missing}: {row['id']}")
    for row in evidence:
        if row["source_id"] not in sources:
            errors.append(f"Evidence references unknown source: {row['id']}")
        if not row.get("locator"):
            errors.append(f"Evidence has no locator: {row['id']}")
        if not row.get("fragment_sha256"):
            warnings.append(f"Locator-only evidence (no extracted fragment hash): {row['id']}")

    procedure_steps: dict[str, list[int]] = defaultdict(list)
    for row in assertions:
        if row["predicate"] == str(TOKG.stepIndex):
            procedure_steps[row["subject"].rsplit("/step-", 1)[0]].append(int(row["object"]))
    for procedure, indexes in procedure_steps.items():
        expected = list(range(1, len(indexes) + 1))
        if sorted(indexes) != expected:
            errors.append(f"Non-contiguous procedure steps for {procedure}: {sorted(indexes)}")

    source_domains = {
        domain
        for source in sources.values()
        for domain in source.raw.get("domains", [])
    }
    required_domains = {"4g", "5g", "ims", "transport", "service", "oam", "kpi-kqi"}
    missing_domains = sorted(required_domains - source_domains)
    if missing_domains:
        errors.append(f"Source baseline misses required domains: {missing_domains}")

    report_graph.serialize(release_dir / "validation-report.ttl", format="turtle")
    report = {
        "conforms": combined_shacl_conforms and not errors,
        "shacl_conforms": combined_shacl_conforms,
        "core_shacl_conforms": bool(core_conforms),
        "shacl_sparql_constraint_count": sparql_constraint_count,
        "shacl_sparql_signature_sha256": sparql_constraint_signature,
        "shacl_sparql_errors": len(sparql_errors),
        "manifest_sha256": _file_sha256(manifest_path),
        "dataset_sha256": _file_sha256(dataset_path),
        "input_hashes_match": input_hashes_match,
        "release_hashes_match": release_hashes_match,
        "checksums_match": checksums_match,
        "custom_errors": errors,
        "warnings": warnings,
        "counts": {
            "entities": len(entities),
            "assertions": len(assertions),
            "evidence_spans": len(evidence),
            "sources": len(sources),
            "locator_only_evidence": len(warnings),
            "entities_by_class": dict(Counter(row["class"] for row in entities)),
        },
        "domain_source_coverage": {
            domain: sum(domain in source.raw.get("domains", []) for source in sources.values())
            for domain in sorted(required_domains)
        },
        "shacl_report": report_text,
    }
    (release_dir / "validation-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if not report["conforms"]:
        raise CatalogError(
            f"Validation failed: SHACL={report['shacl_conforms']}, "
            f"custom_errors={len(errors)}; "
            "see release/validation-report.json"
        )
    return report


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    report = validate_release(args.project_root.resolve())
    print(json.dumps(report["counts"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
