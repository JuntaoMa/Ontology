"""Build a modular RDF dataset with assertion-level provenance."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from rdflib import Dataset, Graph, Literal, URIRef
from rdflib.namespace import DCTERMS, OWL, PROV, RDF, RDFS, SKOS, XSD

from .model import (
    TOKG,
    TOKG_GRAPH,
    TOKG_ID,
    CatalogError,
    SourceRecord,
    assertion_digest,
    build_input_paths,
    catalog_source_ids,
    concept_iri,
    evidence_digest,
    load_catalogs,
    load_sources,
    object_term,
    sha256_text,
    term_iri,
)
from .fragment_index import FragmentIndex


SCHEMA_VERSION = "1.0.0"
DEFAULT_BASELINE = "baseline/rel18-open-standards-2026-07"
DERIVED_STEP_ACTION_RULE = (
    "Derived by structurally projecting a catalog procedure step that has neither "
    "an explicit message nor an explicit action into an Action concept; the step's "
    "bilingual labels and evidence are retained."
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class KnowledgeGraphBuilder:
    def __init__(self, project_root: Path) -> None:
        self.root = project_root
        self.sources = load_sources(project_root)
        self.cited_source_ids = catalog_source_ids(project_root)
        for source in self.sources.values():
            if source.id not in self.cited_source_ids or not source.sha256:
                continue
            if not source.local_path:
                raise CatalogError(f"Locked source {source.id} has no local artifact path")
            artifact_path = Path(source.local_path)
            if not artifact_path.is_absolute():
                artifact_path = project_root / artifact_path
            if not artifact_path.is_file() or file_sha256(artifact_path) != source.sha256:
                raise CatalogError(
                    f"Local artifact for {source.id} is missing or does not match its locked SHA-256"
                )
        index_path = project_root / "evidence" / "fragments.sqlite"
        if not index_path.exists():
            raise CatalogError(
                "evidence/fragments.sqlite is missing; extract and index cited sources before building"
            )
        self.fragment_index = FragmentIndex(index_path)
        self.fragment_index.verify_jsonl(project_root / "evidence" / "fragments.jsonl")
        for source in self.sources.values():
            if (
                source.id in self.cited_source_ids
                and source.sha256
                and self.fragment_index.source_hashes.get(source.id) != source.sha256
            ):
                raise CatalogError(
                    f"Fragment index is missing or stale for locked artifact {source.id}; rebuild it"
                )
        self.dataset = Dataset()
        self.schema = self.dataset.graph(TOKG_GRAPH["ontology/1.0.0"])
        self.catalog = self.dataset.graph(TOKG_GRAPH["catalog/rel18-2026-07"])
        self.assertions = self.dataset.graph(TOKG_GRAPH["assertions/build"])
        self.provenance = self.dataset.graph(TOKG_GRAPH["provenance/build"])
        self.baseline = self.dataset.graph(TOKG_GRAPH["baseline/rel18"])
        self.assertion_rows: list[dict[str, Any]] = []
        self.assertion_row_index: dict[str, dict[str, Any]] = {}
        self.evidence_rows: dict[str, dict[str, Any]] = {}
        self.concept_rows: list[dict[str, Any]] = []
        self.baseline_iri = concept_iri(DEFAULT_BASELINE)
        self.activity_iri = concept_iri("activity/catalog-build/1.0.0")
        self._bind_all()

    def _bind_all(self) -> None:
        for graph in (self.schema, self.catalog, self.assertions, self.provenance, self.baseline):
            graph.bind("tokg", TOKG)
            graph.bind("id", TOKG_ID)
            graph.bind("prov", PROV)
            graph.bind("dcterms", DCTERMS)
            graph.bind("skos", SKOS)
            graph.bind("owl", OWL)

    def load_schema(self) -> None:
        for name in ("core.ttl", "vocabularies.ttl"):
            path = self.root / "ontology" / name
            if not path.exists():
                raise CatalogError(f"Missing ontology schema file: {path}")
            self.schema.parse(path, format="turtle")
        self.provenance.add((self.activity_iri, RDF.type, TOKG.ExtractionActivity))
        self.provenance.add((self.activity_iri, TOKG.parserName, Literal("tokg-build")))
        self.provenance.add((self.activity_iri, TOKG.parserVersion, Literal(SCHEMA_VERSION)))

    def add_sources(self) -> None:
        bodies: dict[str, URIRef] = {}
        for source in self.sources.values():
            body_key = source.organization.lower()
            body = bodies.setdefault(body_key, concept_iri(f"organization/{body_key}"))
            self.provenance.add((body, RDF.type, TOKG.StandardBody))
            self.provenance.add((body, SKOS.notation, Literal(source.organization)))
            self.provenance.add((source.family_iri, RDF.type, TOKG.DocumentFamily))
            self.provenance.add((source.family_iri, TOKG.standardBody, body))
            self.provenance.add((source.family_iri, TOKG.documentType, Literal(source.document_type)))
            self.provenance.add((source.family_iri, TOKG.documentNumber, Literal(source.number)))
            title = source.title or f"{source.organization} {source.number}"
            self.provenance.add((source.family_iri, DCTERMS.title, Literal(title, lang="en")))
            self.provenance.add((source.edition_iri, RDF.type, TOKG.DocumentEdition))
            self.provenance.add((source.edition_iri, TOKG.editionOf, source.family_iri))
            self.provenance.add(
                (source.edition_iri, TOKG.versionString, Literal(source.version or source.number))
            )
            if source.release is not None:
                self.provenance.add(
                    (source.edition_iri, TOKG.release, concept_iri(f"release-{source.release}"))
                )
            self.provenance.add(
                (source.edition_iri, TOKG.language, Literal(source.language, datatype=XSD.language))
            )
            lifecycle_key = source.lifecycle_status.strip().lower().replace("_", "-")
            self.provenance.add(
                (source.edition_iri, TOKG.lifecycleStatus, concept_iri(f"lifecycle-{lifecycle_key}"))
            )
            if source.sha256 and source.id in self.cited_source_ids:
                artifact = source.artifact_iri
                self.provenance.add((artifact, RDF.type, TOKG.DocumentArtifact))
                self.provenance.add((artifact, TOKG.artifactOfEdition, source.edition_iri))
                self.provenance.add(
                    (artifact, TOKG.sourceUrl, Literal(source.official_url, datatype=XSD.anyURI))
                )
                if source.artifact_url:
                    self.provenance.add(
                        (artifact, TOKG.resolvedUrl, Literal(source.artifact_url, datatype=XSD.anyURI))
                    )
                self.provenance.add((artifact, TOKG.sha256, Literal(source.sha256)))
                self.provenance.add(
                    (
                        artifact,
                        TOKG.retrievedAt,
                        Literal(source.retrieved_at or utc_now(), datatype=XSD.dateTime),
                    )
                )
                self.provenance.add(
                    (artifact, TOKG.mediaType, Literal(source.media_type or "application/octet-stream"))
                )
                self.provenance.add(
                    (artifact, TOKG.byteSize, Literal(source.byte_size or 0, datatype=XSD.nonNegativeInteger))
                )

        self.baseline.add((self.baseline_iri, RDF.type, TOKG.Baseline))
        self.baseline.add((self.baseline_iri, SKOS.prefLabel, Literal("3GPP Rel-18 与公开传输/QoE标准基线", lang="zh")))
        self.baseline.add((self.baseline_iri, TOKG.targetRelease, concept_iri("release-18")))
        for source in self.sources.values():
            # The inventory is intentionally broad, but the reproducible
            # extraction baseline contains only artifacts actually fetched and
            # hashed. Metadata-only expansion references remain DocumentFamily
            # and DocumentEdition resources without being misrepresented as
            # verified baseline inputs.
            if not source.sha256 or source.id not in self.cited_source_ids:
                continue
            item_hash = sha256_text(f"{self.baseline_iri}|{source.edition_iri}")
            item = concept_iri(f"baseline-item/sha256/{item_hash}")
            self.baseline.add((item, RDF.type, TOKG.BaselineItem))
            self.baseline.add((item, TOKG.inBaseline, self.baseline_iri))
            self.baseline.add((item, TOKG.documentFamily, source.family_iri))
            self.baseline.add((item, TOKG.selectedEdition, source.edition_iri))
            legacy_3gpp = (
                source.organization.upper() == "3GPP"
                and str(source.release or "") not in {"", "18"}
            )
            inclusion = (
                "informative"
                if source.normative_status == "informative" or legacy_3gpp
                else "normative"
            )
            self.baseline.add((item, TOKG.inclusionType, Literal(inclusion)))
            self.baseline.add((self.baseline_iri, TOKG.hasBaselineItem, item))

    def add_catalogs(self) -> None:
        seen_concepts: set[str] = set()
        for module in load_catalogs(self.root):
            module_name = module.get("module") or Path(module["_path"]).stem
            for concept in module.get("concepts", []):
                local_id = concept["id"]
                if local_id in seen_concepts:
                    raise CatalogError(f"Duplicate concept ID {local_id} in {module_name}")
                seen_concepts.add(local_id)
                self._add_concept(concept, module_name)
            for relation in module.get("relations", []):
                self._add_relation(relation, module_name)
            for procedure in module.get("procedures", []):
                self._add_procedure(procedure, module_name, seen_concepts)
            for metric in module.get("metrics", []):
                self._add_metric(metric, module_name, seen_concepts)

    def _add_concept(self, concept: dict[str, Any], module: str) -> None:
        subject = concept_iri(concept["id"])
        evidence = concept.get("evidence", [])
        derivation_rule = concept.get("derivation_rule")
        assertion_options = {
            "evidence": evidence,
            "status": concept.get("status", "reviewed"),
            "confidence": concept.get("confidence", 1.0),
            "module": module,
            "modality": concept.get(
                "modality", "derived" if derivation_rule else "asserted"
            ),
            "scope": concept.get("scope", [DEFAULT_BASELINE]),
            "derived_from": concept.get("derived_from", []),
            "derivation_rule": derivation_rule,
        }
        self._add_asserted(subject, RDF.type, term_iri(concept["class"]), **assertion_options)
        self._add_asserted(
            subject, TOKG.canonicalKey, Literal(concept.get("canonical_key", concept["id"])), **assertion_options
        )
        for language, key in (("en", "label_en"), ("zh", "label_zh")):
            if concept.get(key):
                self._add_asserted(
                    subject,
                    SKOS.prefLabel,
                    Literal(concept[key], lang=language),
                    **assertion_options,
                )
        if concept.get("notation"):
            self._add_asserted(subject, SKOS.notation, Literal(concept["notation"]), **assertion_options)
        for language, key in (("en", "definition_en"), ("zh", "definition_zh")):
            if concept.get(key):
                self._add_asserted(
                    subject,
                    SKOS.definition,
                    Literal(concept[key], lang=language),
                    **assertion_options,
                )
        for alias in concept.get("aliases", []):
            if isinstance(alias, dict):
                literal = Literal(alias["value"], lang=alias.get("lang"))
            else:
                literal = Literal(alias)
            self._add_asserted(subject, SKOS.altLabel, literal, **assertion_options)
        for fact in concept.get("facts", []):
            relation = {"subject": concept["id"], **fact}
            has_fact_rule = bool(relation.get("derivation_rule"))
            relation.setdefault("evidence", evidence)
            relation.setdefault("status", assertion_options["status"])
            relation.setdefault("confidence", assertion_options["confidence"])
            relation.setdefault("scope", assertion_options["scope"])
            relation.setdefault("derived_from", assertion_options["derived_from"])
            relation.setdefault("derivation_rule", assertion_options["derivation_rule"])
            relation.setdefault(
                "modality", "derived" if has_fact_rule else assertion_options["modality"]
            )
            self._add_relation(relation, module)
        self.concept_rows.append(
            {
                "id": str(subject),
                "class": concept["class"],
                "label_en": concept.get("label_en", ""),
                "label_zh": concept.get("label_zh", ""),
                "notation": concept.get("notation", ""),
                "module": module,
                "status": assertion_options["status"],
                "modality": assertion_options["modality"],
                "confidence": assertion_options["confidence"],
                "derived_from": list(assertion_options["derived_from"]),
                "derivation_rule": assertion_options["derivation_rule"] or "",
            }
        )

    def _add_relation(self, relation: dict[str, Any], module: str) -> None:
        subject = concept_iri(relation["subject"])
        predicate = term_iri(relation["predicate"])
        obj = object_term(relation)
        derivation_rule = relation.get("derivation_rule")
        self._add_asserted(
            subject,
            predicate,
            obj,
            evidence=relation.get("evidence", []),
            status=relation.get("status", "reviewed"),
            confidence=relation.get("confidence", 1.0),
            modality=relation.get(
                "modality", "derived" if derivation_rule else "asserted"
            ),
            scope=relation.get("scope", [DEFAULT_BASELINE]),
            derived_from=relation.get("derived_from", []),
            derivation_rule=derivation_rule,
            module=module,
        )

    def _add_procedure(
        self, procedure: dict[str, Any], module: str, seen_concepts: set[str]
    ) -> None:
        concept = {key: value for key, value in procedure.items() if key != "steps"}
        concept.setdefault("class", "Procedure")
        if concept["id"] in seen_concepts:
            raise CatalogError(f"Duplicate procedure ID: {concept['id']}")
        seen_concepts.add(concept["id"])
        self._add_concept(concept, module)
        procedure_evidence = procedure.get("evidence", [])
        procedure_rule = procedure.get("derivation_rule")
        procedure_modality = procedure.get(
            "modality", "derived" if procedure_rule else "asserted"
        )
        variant_id = procedure.get("variant_id") or f"{procedure['id']}/variant/main"
        if variant_id in seen_concepts:
            raise CatalogError(f"Duplicate procedure variant ID: {variant_id}")
        seen_concepts.add(variant_id)
        self._add_concept(
            {
                "id": variant_id,
                "class": "ProcedureVariant",
                "label_en": procedure.get("variant_label_en", f"{procedure.get('label_en', procedure['id'])} main variant"),
                "label_zh": procedure.get("variant_label_zh", f"{procedure.get('label_zh', procedure['id'])}主流程"),
                "evidence": procedure_evidence,
                "status": procedure.get("status", "reviewed"),
                "confidence": procedure.get("confidence", 1.0),
                "modality": procedure_modality,
                "scope": procedure.get("scope", [DEFAULT_BASELINE]),
                "derived_from": procedure.get("derived_from", []),
                "derivation_rule": procedure_rule,
            },
            module,
        )
        procedure_base = {
            "evidence": procedure_evidence,
            "status": procedure.get("status", "reviewed"),
            "confidence": procedure.get("confidence", 1.0),
            "modality": procedure_modality,
            "scope": procedure.get("scope", [DEFAULT_BASELINE]),
            "derived_from": procedure.get("derived_from", []),
            "derivation_rule": procedure_rule,
        }
        self._add_relation(
            {"subject": procedure["id"], "predicate": "hasVariant", "object": variant_id, **procedure_base},
            module,
        )
        self._add_relation(
            {"subject": variant_id, "predicate": "variantOf", "object": procedure["id"], **procedure_base},
            module,
        )
        for index, step in enumerate(procedure.get("steps", []), 1):
            step_id = step.get("id") or f"{procedure['id']}/step-{index:02d}"
            if step_id in seen_concepts:
                raise CatalogError(f"Duplicate step ID: {step_id}")
            seen_concepts.add(step_id)
            step_evidence = step.get("evidence", procedure_evidence)
            step_rule = step.get("derivation_rule", procedure_rule)
            step_modality = step.get(
                "modality",
                procedure_modality if procedure_rule else ("derived" if step_rule else procedure_modality),
            )
            base = {
                "evidence": step_evidence,
                "status": step.get("status", procedure.get("status", "reviewed")),
                "confidence": step.get("confidence", procedure.get("confidence", 1.0)),
                "modality": step_modality,
                "scope": step.get("scope", procedure.get("scope", [DEFAULT_BASELINE])),
                "derived_from": step.get("derived_from", procedure.get("derived_from", [])),
                "derivation_rule": step_rule,
            }
            self._add_concept(
                {
                    "id": step_id,
                    "class": "ProcedureStep",
                    "label_en": step.get("label_en", f"Step {index}"),
                    "label_zh": step.get("label_zh", f"步骤 {index}"),
                    "evidence": step_evidence,
                    **{key: value for key, value in base.items() if key != "evidence"},
                },
                module,
            )
            self._add_relation(
                {"subject": variant_id, "predicate": "hasStep", "object": step_id, **base}, module
            )
            self._add_relation(
                {"subject": step_id, "predicate": "inProcedure", "object": variant_id, **base}, module
            )
            self._add_relation(
                {
                    "subject": step_id,
                    "predicate": "stepIndex",
                    "literal": {"value": index, "datatype": "xsd:positiveInteger"},
                    **base,
                },
                module,
            )
            self._add_relation(
                {
                    "subject": step_id,
                    "predicate": "stepKey",
                    "literal": str(step.get("key", index)),
                    **base,
                },
                module,
            )
            if step.get("message"):
                missing = [key for key in ("sender", "receiver", "interface") if not step.get(key)]
                if missing:
                    raise CatalogError(
                        f"Message step {step_id} is missing required exchange fields: {missing}"
                    )
                exchange_id = f"{step_id}/exchange"
                seen_concepts.add(exchange_id)
                self._add_concept(
                    {
                        "id": exchange_id,
                        "class": "MessageExchange",
                        "label_en": f"Exchange in {step.get('label_en', f'Step {index}')}",
                        "label_zh": f"{step.get('label_zh', f'步骤 {index}')}消息交换",
                        "evidence": step_evidence,
                        **{key: value for key, value in base.items() if key != "evidence"},
                    },
                    module,
                )
                for predicate, object_id in (
                    ("inStep", step_id),
                    ("senderRole", step["sender"]),
                    ("receiverRole", step["receiver"]),
                    ("exchangeMessage", step["message"]),
                    ("overInterface", step["interface"]),
                ):
                    self._add_relation(
                        {"subject": exchange_id, "predicate": predicate, "object": object_id, **base}, module
                    )
                self._add_relation(
                    {"subject": step_id, "predicate": "hasMessageExchange", "object": exchange_id, **base}, module
                )
            if not step.get("message") and not step.get("action"):
                action_id = f"{step_id}/action"
                if action_id in seen_concepts:
                    raise CatalogError(f"Duplicate derived step action ID: {action_id}")
                seen_concepts.add(action_id)
                action_base = {
                    "evidence": step_evidence,
                    "status": "proposed",
                    "confidence": base["confidence"],
                    "modality": "derived",
                    "scope": base["scope"],
                    "derived_from": [step_id],
                    "derivation_rule": DERIVED_STEP_ACTION_RULE,
                }
                step_label_en = step.get("label_en", f"Step {index}")
                step_label_zh = step.get("label_zh", f"步骤 {index}")
                self._add_concept(
                    {
                        "id": action_id,
                        "class": "Action",
                        "label_en": f"Action: {step_label_en}",
                        "label_zh": f"动作：{step_label_zh}",
                        **action_base,
                    },
                    module,
                )
                self._add_relation(
                    {
                        "subject": step_id,
                        "predicate": "performsAction",
                        "object": action_id,
                        **action_base,
                    },
                    module,
                )
            for key, predicate in (("action", "performsAction"), ("timer", "usesTimer")):
                if step.get(key):
                    self._add_relation(
                        {"subject": step_id, "predicate": predicate, "object": step[key], **base}, module
                    )
            if step.get("outcome"):
                self._add_relation(
                    {"subject": step_id, "predicate": "outcome", "object": step["outcome"], **base}, module
                )
            if step.get("condition"):
                self._add_relation(
                    {
                        "subject": step_id,
                        "predicate": "conditionText",
                        "literal": {"value": step["condition"], "lang": "en"},
                        **base,
                    },
                    module,
                )
            if index > 1:
                previous = procedure.get("steps", [])[index - 2]
                previous_id = previous.get("id") or f"{procedure['id']}/step-{index - 1:02d}"
                edge_id = f"{variant_id}/edge-{index - 1:02d}-{index:02d}"
                seen_concepts.add(edge_id)
                self._add_concept(
                    {
                        "id": edge_id,
                        "class": "FlowEdge",
                        "label_en": f"Flow edge {index - 1} to {index}",
                        "label_zh": f"流程边 {index - 1} 至 {index}",
                        "evidence": step_evidence,
                        **{key: value for key, value in base.items() if key != "evidence"},
                    },
                    module,
                )
                for predicate, object_id in (("fromStep", previous_id), ("toStep", step_id)):
                    self._add_relation(
                        {"subject": edge_id, "predicate": predicate, "object": object_id, **base}, module
                    )
                self._add_relation(
                    {"subject": variant_id, "predicate": "hasFlowEdge", "object": edge_id, **base}, module
                )

    def _add_metric(
        self, metric: dict[str, Any], module: str, seen_concepts: set[str]
    ) -> None:
        structural_keys = {
            "formula",
            "formula_language",
            "operands",
            "unit",
            "measurement_object",
            "aggregation_window",
            "aggregation_function",
            "zero_denominator_policy",
            "measures_service",
            "depends_on_metrics",
        }
        concept = {key: value for key, value in metric.items() if key not in structural_keys}
        concept.setdefault("class", "KPI")
        if metric.get("derivation_rule"):
            concept.setdefault("modality", "derived")
        if concept["id"] in seen_concepts:
            raise CatalogError(f"Duplicate metric ID: {concept['id']}")
        seen_concepts.add(concept["id"])
        self._add_concept(concept, module)
        evidence = metric.get("evidence", [])
        common = {
            "evidence": evidence,
            "status": metric.get("status", "reviewed"),
            "confidence": metric.get("confidence", 1.0),
            "modality": metric.get(
                "modality", "derived" if metric.get("derivation_rule") else "asserted"
            ),
            "derived_from": metric.get("derived_from", metric.get("depends_on_metrics", [])),
            "derivation_rule": metric.get("derivation_rule"),
            "scope": metric.get("scope", [DEFAULT_BASELINE]),
        }
        for key, predicate, datatype in (
            ("unit", "unit", "xsd:string"),
            ("aggregation_window", "aggregationWindow", "xsd:duration"),
        ):
            if metric.get(key) is not None:
                self._add_relation(
                    {
                        "subject": metric["id"],
                        "predicate": predicate,
                        "literal": {"value": metric[key], "datatype": datatype},
                        **common,
                    },
                    module,
                )
        if metric.get("measurement_object"):
            self._add_relation(
                {
                    "subject": metric["id"],
                    "predicate": "measurementObject",
                    "object": metric["measurement_object"],
                    **common,
                },
                module,
            )
        if metric.get("aggregation_function"):
            function = str(metric["aggregation_function"]).strip().lower().replace("_", "-")
            if not function.startswith("aggregation-"):
                function = f"aggregation-{function}"
            self._add_relation(
                {
                    "subject": metric["id"],
                    "predicate": "aggregationFunction",
                    "object": function,
                    **common,
                },
                module,
            )
        zero_policy = str(metric.get("zero_denominator_policy", "not-applicable")).strip().lower().replace("_", "-")
        if not zero_policy.startswith("zero-policy-"):
            zero_policy = f"zero-policy-{zero_policy}"
        if concept["class"] == "KPI":
            self._add_relation(
                {
                    "subject": metric["id"],
                    "predicate": "zeroDenominatorPolicy",
                    "object": zero_policy,
                    **common,
                },
                module,
            )
        for service in metric.get("measures_service", []):
            self._add_relation(
                {"subject": metric["id"], "predicate": "measuresService", "object": service, **common},
                module,
            )
        for dependency in metric.get("depends_on_metrics", []):
            self._add_relation(
                {"subject": metric["id"], "predicate": "dependsOnMetric", "object": dependency, **common},
                module,
            )

        raw_formula = metric.get("formula")
        formula_text = raw_formula.get("expression") if isinstance(raw_formula, dict) else raw_formula
        if formula_text:
            formula_normative = (
                bool(raw_formula["normative"])
                if isinstance(raw_formula, dict) and "normative" in raw_formula
                else not bool(metric.get("derivation_rule"))
            )
            formula_id = f"formula/{sha256_text(metric['id'] + '|' + formula_text)}"
            self._add_concept(
                {
                    "id": formula_id,
                    "class": "Formula",
                    "label_en": f"Formula for {metric.get('label_en', metric['id'])}",
                    "label_zh": f"{metric.get('label_zh', metric['id'])}公式",
                    "evidence": evidence,
                    "status": metric.get("status", "reviewed"),
                    "confidence": metric.get("confidence", 1.0),
                    "modality": common["modality"],
                    "derived_from": common["derived_from"],
                    "derivation_rule": common["derivation_rule"],
                    "scope": common["scope"],
                    "facts": [
                        {
                            "predicate": "formulaExpression",
                            "literal": {"value": formula_text, "datatype": "xsd:string"},
                            "modality": "derived" if metric.get("derivation_rule") else "asserted",
                            "derived_from": metric.get("derived_from", metric.get("depends_on_metrics", [])),
                            "derivation_rule": metric.get("derivation_rule"),
                        },
                        {
                            "predicate": "formulaLanguage",
                            "literal": {
                                "value": (
                                    raw_formula.get("language", "infix")
                                    if isinstance(raw_formula, dict)
                                    else metric.get("formula_language", "infix")
                                ),
                                "datatype": "xsd:string",
                            },
                        },
                        {
                            "predicate": "formulaNormative",
                            "literal": {
                                "value": formula_normative,
                                "datatype": "xsd:boolean",
                            },
                        },
                    ],
                },
                module,
            )
            seen_concepts.add(formula_id)
            self._add_relation(
                {"subject": metric["id"], "predicate": "hasFormula", "object": formula_id, **common}, module
            )
            for index, operand in enumerate(metric.get("operands", []), 1):
                if isinstance(operand, dict):
                    metric_ref = operand.get("metric") or operand.get("counter") or operand.get("id")
                    role = operand.get("role") or operand.get("name") or f"operand-{index}"
                else:
                    metric_ref = operand
                    role = f"operand-{index}"
                if not metric_ref:
                    raise CatalogError(f"Metric {metric['id']} has an operand without a metric reference")
                operand_id = f"{formula_id}/operand-{index:02d}"
                if operand_id in seen_concepts:
                    raise CatalogError(f"Duplicate formula operand ID: {operand_id}")
                seen_concepts.add(operand_id)
                self._add_concept(
                    {
                        "id": operand_id,
                        "class": "FormulaOperand",
                        "label_en": f"{role} operand for {metric.get('label_en', metric['id'])}",
                        "label_zh": f"{metric.get('label_zh', metric['id'])}的{role}操作数",
                        "evidence": evidence,
                        "status": common["status"],
                        "confidence": common["confidence"],
                        "modality": common["modality"],
                        "derived_from": common["derived_from"],
                        "derivation_rule": common["derivation_rule"],
                        "scope": common["scope"],
                    },
                    module,
                )
                self._add_relation(
                    {"subject": formula_id, "predicate": "hasOperand", "object": operand_id, **common}, module
                )
                self._add_relation(
                    {"subject": operand_id, "predicate": "operandOf", "object": formula_id, **common}, module
                )
                self._add_relation(
                    {"subject": operand_id, "predicate": "referencesMetric", "object": metric_ref, **common}, module
                )
                self._add_relation(
                    {
                        "subject": operand_id,
                        "predicate": "operandRole",
                        "literal": {"value": str(role), "datatype": "xsd:string"},
                        **common,
                    },
                    module,
                )

    def _add_asserted(
        self,
        subject: URIRef,
        predicate: URIRef,
        obj: URIRef | Literal,
        *,
        evidence: Iterable[dict[str, Any]],
        status: str,
        confidence: float,
        module: str,
        modality: str = "asserted",
        scope: Iterable[str] = (DEFAULT_BASELINE,),
        derived_from: Iterable[str] = (),
        derivation_rule: str | None = None,
    ) -> None:
        scope_list = list(scope)
        derived_from_list = list(derived_from)
        modality_key = modality.strip().lower().replace("_", "-")
        status_key = status.strip().lower().replace("_", "-")
        self.catalog.add((subject, predicate, obj))
        if DEFAULT_BASELINE in scope_list:
            self.baseline.add((subject, predicate, obj))
        digest = assertion_digest(
            subject,
            predicate,
            obj,
            modality=modality_key,
            scope=scope_list,
            status=status_key,
            confidence=confidence,
            derived_from=derived_from_list,
            derivation_rule=derivation_rule or "",
        )
        assertion = concept_iri(f"assertion/sha256/{digest}")
        self.assertions.add((assertion, RDF.type, TOKG.Assertion))
        self.assertions.add((assertion, TOKG.assertionSubject, subject))
        self.assertions.add((assertion, TOKG.assertionPredicate, predicate))
        if isinstance(obj, URIRef):
            self.assertions.add((assertion, TOKG.assertionObject, obj))
        else:
            self.assertions.add((assertion, TOKG.literalObject, obj))
        self.assertions.add((assertion, TOKG.polarity, concept_iri("polarity-positive")))
        self.assertions.add(
            (assertion, TOKG.assertionModality, concept_iri(f"assertion-modality-{modality_key}"))
        )
        self.assertions.add(
            (assertion, TOKG.assertionStatus, concept_iri(f"assertion-status-{status_key}"))
        )
        self.assertions.add((assertion, TOKG.confidence, Literal(confidence, datatype=XSD.decimal)))
        for scope_id in scope_list:
            self.assertions.add((assertion, TOKG.applicabilityScope, concept_iri(scope_id)))
        self.assertions.add((assertion, TOKG.generatedBy, self.activity_iri))
        evidence_ids: list[str] = []
        evidence_links: list[dict[str, str]] = []
        evidence_id_set: set[str] = set()
        evidence_link_set: set[tuple[str, str, str]] = set()
        for evidence_record in evidence:
            evidence_iri = self._add_evidence(assertion, evidence_record)
            evidence_id = str(evidence_iri)
            directness = str(evidence_record.get("directness", "explicit")).strip().lower().replace("_", "-")
            if evidence_id not in evidence_id_set:
                evidence_ids.append(evidence_id)
                evidence_id_set.add(evidence_id)
            link_key = (evidence_id, "supports", directness)
            if link_key not in evidence_link_set:
                evidence_links.append(
                    {
                        "evidence_id": evidence_id,
                        "role": "supports",
                        "directness": directness,
                    }
                )
                evidence_link_set.add(link_key)
        for parent in derived_from_list:
            self.assertions.add((assertion, TOKG.derivedFrom, concept_iri(parent)))
        if derivation_rule:
            self.assertions.add((assertion, TOKG.derivationRule, Literal(derivation_rule)))
        row = self.assertion_row_index.get(str(assertion))
        if row is None:
            row = {
                "id": str(assertion),
                "subject": str(subject),
                "predicate": str(predicate),
                "object_kind": "iri" if isinstance(obj, URIRef) else "literal",
                "object": str(obj),
                "datatype": str(obj.datatype) if isinstance(obj, Literal) and obj.datatype else "",
                "lang": obj.language if isinstance(obj, Literal) and obj.language else "",
                "status": status_key,
                "modality": modality_key,
                "confidence": confidence,
                "module": module,
                "modules": [module],
                "scope": scope_list,
                "derived_from": derived_from_list,
                "derivation_rule": derivation_rule or "",
                "evidence_ids": evidence_ids,
                "evidence_links": evidence_links,
            }
            self.assertion_rows.append(row)
            self.assertion_row_index[str(assertion)] = row
        else:
            if module not in row["modules"]:
                row["modules"].append(module)
            for evidence_id in evidence_ids:
                if evidence_id not in row["evidence_ids"]:
                    row["evidence_ids"].append(evidence_id)
            existing_links = {
                (item["evidence_id"], item["role"], item["directness"])
                for item in row["evidence_links"]
            }
            row["evidence_links"].extend(
                item
                for item in evidence_links
                if (item["evidence_id"], item["role"], item["directness"])
                not in existing_links
            )

    def _add_evidence(self, assertion: URIRef, record: dict[str, Any]) -> URIRef:
        source_id = record.get("source")
        if source_id not in self.sources:
            raise CatalogError(f"Unknown source ID in evidence: {source_id}")
        source = self.sources[source_id]
        if not source.sha256:
            raise CatalogError(
                f"Evidence cites {source_id}, but its official artifact has not been fetched and hashed"
            )
        locator = str(record.get("locator", "")).strip()
        if not locator:
            raise CatalogError(f"Evidence for {source_id} has no locator")
        selector = {
            **record,
            "_require_locator_match": source.organization.upper() == "3GPP",
        }
        fragment = self.fragment_index.find(selector)
        fragment_hash = ""
        fragment_id = ""
        fragment_locator = ""
        fragment_section = ""
        quote = record.get("quote", "")
        if source.organization.upper() != "3GPP" and not quote:
            raise CatalogError(
                f"External evidence {source_id} {locator} requires an exact quote from the hashed artifact"
            )
        if not fragment:
            raise CatalogError(
                f"Evidence {source_id} {locator} has no matching fragment from its hashed artifact"
            )
        if fragment:
            fragment_source_hash = str(fragment.get("source_sha256") or "")
            if fragment_source_hash != source.sha256:
                raise CatalogError(
                    f"Evidence fragment for {source_id} belongs to artifact {fragment_source_hash or 'unknown'}, "
                    f"not the locked artifact {source.sha256}"
                )
            fragment_hash = fragment.get("content_hash") or fragment.get("normalized_text_sha256") or fragment.get("sha256") or ""
            computed_fragment_hash = sha256_text(str(fragment.get("text") or ""))
            if fragment_hash != computed_fragment_hash:
                raise CatalogError(
                    f"Evidence fragment {fragment.get('fragment_id') or 'unknown'} for {source_id} "
                    "has a content-hash mismatch"
                )
            fragment_id = fragment.get("fragment_id", "")
            fragment_locator = str(fragment.get("locator") or "")
            fragment_section = str(fragment.get("section_number") or "")
            if quote:
                normalized_quote = " ".join(str(quote).split())
                normalized_fragment = " ".join(str(fragment.get("text", "")).split())
                if normalized_quote not in normalized_fragment:
                    raise CatalogError(
                        f"Exact quote for {source_id} {locator} was not found in the selected hashed artifact fragment"
                    )
        if not fragment_hash:
            raise CatalogError(
                f"Evidence {source_id} {locator} has neither a matched source fragment nor an exact quote"
            )
        normalized_quote_hash = sha256_text(" ".join(str(quote).split())) if quote else ""
        resolved_locator = fragment_locator or (
            f"section {fragment_section}" if fragment_section else locator
        )
        canonical_locator = locator if source.organization.upper() == "3GPP" else resolved_locator
        part_kind = str(record.get("part_kind", "clause"))
        if source.organization.upper() != "3GPP":
            block_type = str(fragment.get("block_type") or "")
            if block_type == "pdf-page" or resolved_locator.casefold().startswith("page "):
                part_kind = "page"
            elif block_type in {"html-document", "text-document"} or resolved_locator == "document":
                part_kind = "document"
        digest = evidence_digest(
            source_id,
            canonical_locator,
            fragment_hash,
            normalized_quote_hash,
            source.sha256,
            fragment_id,
            locator,
        )
        evidence_iri = concept_iri(f"evidence/sha256/{digest}")
        part_iri = concept_iri(
            f"document-part/{source_id}/{source.sha256[:16]}/{sha256_text(canonical_locator)[:20]}"
        )
        self.provenance.add((part_iri, RDF.type, TOKG.DocumentPart))
        self.provenance.add((part_iri, TOKG.partOfArtifact, source.artifact_iri))
        self.provenance.add((part_iri, TOKG.partKind, Literal(part_kind)))
        self.provenance.add((part_iri, TOKG.canonicalLocator, Literal(canonical_locator)))
        normative_key = source.normative_status if source.normative_status in {"normative", "informative"} else "normative-unknown"
        self.provenance.add((part_iri, TOKG.normativeStatus, concept_iri(normative_key)))
        self.provenance.add((evidence_iri, RDF.type, TOKG.EvidenceSpan))
        self.provenance.add((evidence_iri, TOKG.evidenceArtifact, source.artifact_iri))
        self.provenance.add((evidence_iri, TOKG.evidencePart, part_iri))
        self.provenance.add((evidence_iri, TOKG.locatorText, Literal(canonical_locator)))
        if locator != canonical_locator:
            self.provenance.add((evidence_iri, TOKG.reportedLocatorText, Literal(locator)))
        if fragment_hash:
            self.provenance.add((evidence_iri, TOKG.normalizedTextSha256, Literal(fragment_hash)))
        if fragment_id:
            self.provenance.add((evidence_iri, TOKG.fragmentIdentifier, Literal(fragment_id)))
        if fragment_locator:
            self.provenance.add(
                (evidence_iri, TOKG.resolvedFragmentLocator, Literal(fragment_locator))
            )
        if fragment_section:
            self.provenance.add(
                (evidence_iri, TOKG.resolvedSectionNumber, Literal(fragment_section))
            )
        if quote:
            self.provenance.add((evidence_iri, TOKG.exactQuote, Literal(quote)))
            self.provenance.add((evidence_iri, TOKG.exactTextSha256, Literal(normalized_quote_hash)))
        directness = str(record.get("directness", "explicit")).strip().lower().replace("_", "-")
        link_digest = sha256_text(f"{assertion}|{evidence_iri}|supports|{directness}")
        link = concept_iri(f"assertion-evidence/sha256/{link_digest}")
        self.provenance.add((link, RDF.type, TOKG.AssertionEvidence))
        self.provenance.add((link, TOKG.forAssertion, assertion))
        self.provenance.add((link, TOKG.evidenceSpan, evidence_iri))
        self.provenance.add((link, TOKG.evidenceRole, concept_iri("evidence-role-supports")))
        self.provenance.add((link, TOKG.evidenceDirectness, concept_iri(f"evidence-{directness}")))
        self.provenance.add((link, TOKG.generatedBy, self.activity_iri))
        self.assertions.add((assertion, TOKG.hasAssertionEvidence, link))
        row = {
            "id": str(evidence_iri),
            "source_id": source_id,
            "artifact_id": str(source.artifact_iri),
            "locator": canonical_locator,
            "reported_locator": locator,
            "fragment_id": fragment_id,
            "fragment_locator": fragment_locator,
            "fragment_section": fragment_section,
            "fragment_sha256": fragment_hash,
            "quote": quote,
            "official_url": source.official_url,
            "artifact_url": source.artifact_url or "",
        }
        self.evidence_rows[str(evidence_iri)] = row
        return evidence_iri

    def serialize(self) -> dict[str, Any]:
        release_dir = self.root / "release"
        jsonl_dir = release_dir / "jsonl"
        csv_dir = release_dir / "csv"
        release_dir.mkdir(exist_ok=True)
        jsonl_dir.mkdir(exist_ok=True)
        csv_dir.mkdir(exist_ok=True)

        outputs = {
            "ontology.ttl": self.schema,
            "catalog.ttl": self.catalog,
            "assertions.ttl": self.assertions,
            "provenance.ttl": self.provenance,
            "baseline-rel18.ttl": self.baseline,
        }
        for filename, graph in outputs.items():
            graph.serialize(release_dir / filename, format="turtle")
        self.dataset.serialize(release_dir / "dataset.trig", format="trig")

        self._write_jsonl(jsonl_dir / "entities.jsonl", self.concept_rows)
        self._write_jsonl(jsonl_dir / "assertions.jsonl", self.assertion_rows)
        self._write_jsonl(jsonl_dir / "evidence_spans.jsonl", self.evidence_rows.values())
        entity_csv = [
            {**row, "derived_from": "|".join(row["derived_from"])}
            for row in self.concept_rows
        ]
        self._write_csv(csv_dir / "entities.csv", entity_csv)
        assertion_csv = [
            {
                **row,
                "scope": "|".join(row["scope"]),
                "derived_from": "|".join(row["derived_from"]),
                "modules": "|".join(row["modules"]),
                "evidence_ids": "|".join(row["evidence_ids"]),
                "evidence_links": json.dumps(row["evidence_links"], ensure_ascii=False, sort_keys=True),
            }
            for row in self.assertion_rows
        ]
        self._write_csv(csv_dir / "assertions.csv", assertion_csv)
        self._write_csv(csv_dir / "evidence_spans.csv", self.evidence_rows.values())

        stats = {
            "schema_triples": len(self.schema),
            "catalog_triples": len(self.catalog),
            "assertion_graph_triples": len(self.assertions),
            "provenance_triples": len(self.provenance),
            "baseline_triples": len(self.baseline),
            "concepts": len(self.concept_rows),
            "assertions": len(self.assertion_rows),
            "evidence_spans": len(self.evidence_rows),
            "sources": len(self.sources),
            "assertions_by_module": dict(
                Counter(
                    module
                    for row in self.assertion_rows
                    for module in row["modules"]
                )
            ),
            "assertions_by_status": dict(Counter(row["status"] for row in self.assertion_rows)),
            "assertions_by_modality": dict(Counter(row["modality"] for row in self.assertion_rows)),
            "concepts_by_class": dict(Counter(row["class"] for row in self.concept_rows)),
            "concepts_by_status": dict(Counter(row["status"] for row in self.concept_rows)),
            "concepts_by_modality": dict(Counter(row["modality"] for row in self.concept_rows)),
        }
        generated_files = sorted(
            [release_dir / name for name in outputs]
            + [release_dir / "dataset.trig"]
            + [
                jsonl_dir / "entities.jsonl",
                jsonl_dir / "assertions.jsonl",
                jsonl_dir / "evidence_spans.jsonl",
                csv_dir / "entities.csv",
                csv_dir / "assertions.csv",
                csv_dir / "evidence_spans.csv",
            ]
        )
        file_hashes = {
            str(path.relative_to(release_dir)): file_sha256(path) for path in generated_files
        }
        input_files = build_input_paths(self.root)
        input_hashes = {
            str(path.relative_to(self.root)): file_sha256(path) for path in input_files
        }
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "generated_at": utc_now(),
            "baseline": str(self.baseline_iri),
            "checksum_file": "checksums.sha256",
            "statistics": stats,
            "inputs": input_hashes,
            "files": file_hashes,
        }
        manifest_path = release_dir / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        checksum_entries = {**file_hashes, "manifest.json": file_sha256(manifest_path)}
        checksum_lines = [
            f"{digest}  {name}" for name, digest in sorted(checksum_entries.items())
        ]
        (release_dir / "checksums.sha256").write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")
        return manifest

    @staticmethod
    def _write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
        path.write_text(
            "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows),
            encoding="utf-8",
        )

    @staticmethod
    def _write_csv(path: Path, rows: Iterable[dict[str, Any]]) -> None:
        materialized = list(rows)
        if not materialized:
            path.write_text("", encoding="utf-8")
            return
        fields = list(materialized[0])
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(materialized)


def build(project_root: Path) -> dict[str, Any]:
    builder = KnowledgeGraphBuilder(project_root)
    builder.load_schema()
    builder.add_sources()
    builder.add_catalogs()
    return builder.serialize()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    manifest = build(args.project_root.resolve())
    print(json.dumps(manifest["statistics"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
