from pathlib import Path

import pytest
from pyshacl import validate as shacl_validate
from rdflib import Graph, Literal, Namespace
from rdflib.namespace import RDF, RDFS, SH, XSD

from tokg.validate import (
    _EXPECTED_SPARQL_CONSTRAINTS,
    _EXPECTED_SPARQL_SIGNATURE_SHA256,
    _SPARQL_RULE_MESSAGES,
    _combined_shacl_report_text,
    _core_shapes_without_sparql,
    _find_sparql_violations,
    _merge_sparql_validation_results,
    _sparql_constraint_signature,
    _validate_sparql_constraints,
)


ROOT = Path(__file__).resolve().parents[1]
SHAPES_PATH = ROOT / "shapes" / "tokg-shapes.ttl"
TOKG = Namespace("https://example.org/tokg/ontology#")
ID = Namespace("https://example.org/tokg/id/")


CASES = [
    (
        "document-edition-self-predecessor",
        [
            (ID.focus, RDF.type, TOKG.DocumentEdition),
            (ID.focus, TOKG.predecessorEdition, ID.focus),
        ],
    ),
    (
        "evidence-char-pair",
        [
            (ID.focus, RDF.type, TOKG.EvidenceSpan),
            (ID.focus, TOKG.startChar, Literal(1)),
        ],
    ),
    (
        "evidence-char-order",
        [
            (ID.focus, RDF.type, TOKG.EvidenceSpan),
            (ID.focus, TOKG.startChar, Literal(2)),
            (ID.focus, TOKG.endChar, Literal(1)),
        ],
    ),
    (
        "evidence-exact-quote-hash",
        [
            (ID.focus, RDF.type, TOKG.EvidenceSpan),
            (ID.focus, TOKG.exactQuote, Literal("quoted text")),
        ],
    ),
    (
        "assertion-reviewed-support",
        [
            (ID.focus, RDF.type, TOKG.Assertion),
            (ID.focus, TOKG.assertionStatus, ID["assertion-status-reviewed"]),
        ],
    ),
    (
        "assertion-derived-derivation",
        [
            (ID.focus, RDF.type, TOKG.Assertion),
            (ID.focus, TOKG.assertionModality, ID["assertion-modality-derived"]),
        ],
    ),
    (
        "evidence-link-backreference",
        [
            (ID.focus, RDF.type, TOKG.AssertionEvidence),
            (ID.focus, TOKG.forAssertion, ID.assertion),
        ],
    ),
    (
        "evidence-inferred-derivation",
        [
            (ID.focus, RDF.type, TOKG.AssertionEvidence),
            (ID.focus, TOKG.forAssertion, ID.assertion),
            (ID.focus, TOKG.evidenceDirectness, ID["evidence-inferred"]),
            (ID.assertion, TOKG.hasAssertionEvidence, ID.focus),
        ],
    ),
    (
        "procedure-step-index-unique",
        [
            (ID.focus, RDF.type, TOKG.ProcedureStep),
            (ID.focus, TOKG.inProcedure, ID.variant),
            (ID.focus, TOKG.stepIndex, Literal(1)),
            (ID.other, TOKG.inProcedure, ID.variant),
            (ID.other, TOKG.stepIndex, Literal(1)),
        ],
    ),
    (
        "procedure-step-key-unique",
        [
            (ID.focus, RDF.type, TOKG.ProcedureStep),
            (ID.focus, TOKG.inProcedure, ID.variant),
            (ID.focus, TOKG.stepKey, Literal("duplicate")),
            (ID.other, TOKG.inProcedure, ID.variant),
            (ID.other, TOKG.stepKey, Literal("duplicate")),
        ],
    ),
    (
        "flow-edge-procedure",
        [
            (ID.focus, RDF.type, TOKG.FlowEdge),
            (ID.focus, TOKG.fromStep, ID.left),
            (ID.focus, TOKG.toStep, ID.right),
            (ID.left, TOKG.inProcedure, ID.variant1),
            (ID.right, TOKG.inProcedure, ID.variant2),
        ],
    ),
    (
        "message-exchange-loopback",
        [
            (ID.focus, RDF.type, TOKG.MessageExchange),
            (ID.focus, TOKG.senderRole, ID.role),
            (ID.focus, TOKG.receiverRole, ID.role),
        ],
    ),
    (
        "message-exchange-protocol-binding",
        [
            (ID.focus, RDF.type, TOKG.MessageExchange),
            (ID.focus, TOKG.exchangeMessage, ID.message),
            (ID.focus, TOKG.overInterface, ID.interface),
            (ID.message, TOKG.definedByProtocol, ID.protocol),
        ],
    ),
    (
        "ie-min-max-order",
        [
            (ID.focus, RDF.type, TOKG.IEUsage),
            (ID.focus, TOKG.minOccurs, Literal(2)),
            (ID.focus, TOKG.maxOccurs, Literal(1)),
        ],
    ),
    (
        "ie-mandatory-min-occurs",
        [
            (ID.focus, RDF.type, TOKG.IEUsage),
            (ID.focus, TOKG.presence, ID["presence-mandatory"]),
            (ID.focus, TOKG.minOccurs, Literal(0)),
        ],
    ),
    (
        "ie-conditional-condition",
        [
            (ID.focus, RDF.type, TOKG.IEUsage),
            (ID.focus, TOKG.presence, ID["presence-conditional"]),
        ],
    ),
    (
        "dependency-self-reference",
        [
            (ID.focus, RDF.type, TOKG.Dependency),
            (ID.focus, TOKG.dependencySource, ID.resource),
            (ID.focus, TOKG.dependencyTarget, ID.resource),
        ],
    ),
    (
        "baseline-duplicate-main-edition",
        [
            (ID.focus, RDF.type, TOKG.Baseline),
            (ID.focus, TOKG.hasBaselineItem, ID.item1),
            (ID.focus, TOKG.hasBaselineItem, ID.item2),
            (ID.item1, TOKG.documentFamily, ID.family),
            (ID.item2, TOKG.documentFamily, ID.family),
            (ID.item1, TOKG.inclusionType, Literal("normative")),
            (ID.item2, TOKG.inclusionType, Literal("normative", datatype=XSD.string)),
        ],
    ),
    (
        "baseline-item-edition-family",
        [
            (ID.focus, RDF.type, TOKG.BaselineItem),
            (ID.focus, TOKG.documentFamily, ID.family),
            (ID.focus, TOKG.selectedEdition, ID.edition),
            (ID.edition, TOKG.editionOf, ID.other_family),
        ],
    ),
]


@pytest.fixture(scope="module")
def source_shapes() -> Graph:
    return Graph().parse(SHAPES_PATH, format="turtle")


@pytest.mark.parametrize(("expected_rule", "triples"), CASES)
def test_python_replacement_detects_each_sparql_constraint(
    expected_rule: str, triples: list[tuple], source_shapes: Graph
) -> None:
    graph = Graph()
    for triple in triples:
        graph.add(triple)

    errors = _validate_sparql_constraints(graph)
    source_conforms, _, source_report = shacl_validate(
        graph, shacl_graph=source_shapes, advanced=True
    )

    assert len(errors) == 1
    assert f"SHACL-SPARQL[{expected_rule}]" in errors[0]
    assert _SPARQL_RULE_MESSAGES[expected_rule] in errors[0]
    assert not source_conforms
    assert _SPARQL_RULE_MESSAGES[expected_rule] in source_report


def test_shapes_parse_and_runtime_copy_detaches_exactly_the_implemented_constraints() -> None:
    shapes = Graph().parse(SHAPES_PATH, format="turtle")
    original_size = len(shapes)
    original_attachments = set(shapes.triples((None, SH.sparql, None)))

    core_shapes, attachment_count = _core_shapes_without_sparql(shapes)

    assert attachment_count == _EXPECTED_SPARQL_CONSTRAINTS == len(_SPARQL_RULE_MESSAGES)
    assert len(original_attachments) == _EXPECTED_SPARQL_CONSTRAINTS
    assert not set(core_shapes.triples((None, SH.sparql, None)))
    assert len(shapes) == original_size
    assert set(shapes.triples((None, SH.sparql, None))) == original_attachments


def test_runtime_copy_still_enforces_shacl_core_constraints() -> None:
    shapes = Graph().parse(SHAPES_PATH, format="turtle")
    core_shapes, _ = _core_shapes_without_sparql(shapes)
    data = Graph()
    data.add((ID.focus, RDF.type, TOKG.Concept))

    conforms, _, report_text = shacl_validate(data, shacl_graph=core_shapes)

    assert not conforms
    assert "canonical key" in report_text


def test_sparql_signature_fails_closed_when_query_changes_without_count_change(
    source_shapes: Graph,
) -> None:
    shapes = Graph()
    for triple in source_shapes:
        shapes.add(triple)
    assert _sparql_constraint_signature(shapes) == _EXPECTED_SPARQL_SIGNATURE_SHA256

    _, constraint = next(shapes.subject_objects(SH.sparql))
    select = shapes.value(constraint, SH.select)
    assert isinstance(select, Literal)
    shapes.remove((constraint, SH.select, select))
    shapes.add((constraint, SH.select, Literal(f"{select}\n# semantic drift")))

    assert len(set(shapes.triples((None, SH.sparql, None)))) == _EXPECTED_SPARQL_CONSTRAINTS
    assert _sparql_constraint_signature(shapes) != _EXPECTED_SPARQL_SIGNATURE_SHA256

    implicit_target_shapes = Graph()
    for triple in source_shapes:
        implicit_target_shapes.add(triple)
    shape, _ = next(implicit_target_shapes.subject_objects(SH.sparql))
    implicit_target_shapes.add((shape, RDF.type, RDFS.Class))
    assert (
        _sparql_constraint_signature(implicit_target_shapes)
        != _EXPECTED_SPARQL_SIGNATURE_SHA256
    )


def test_python_rules_use_the_same_rdfs_materialization_as_core(
    source_shapes: Graph,
) -> None:
    core_shapes, _ = _core_shapes_without_sparql(source_shapes)
    data = Graph()
    data.add((TOKG.predecessorEdition, RDFS.domain, TOKG.DocumentEdition))
    data.add((ID.focus, TOKG.predecessorEdition, ID.focus))

    shacl_validate(
        data,
        shacl_graph=core_shapes,
        inference="rdfs",
        inplace=True,
        abort_on_first=False,
    )

    errors = _validate_sparql_constraints(data)
    assert any("document-edition-self-predecessor" in error for error in errors)


def test_python_violations_are_merged_into_graph_and_text_report() -> None:
    data = Graph()
    data.add((ID.focus, RDF.type, TOKG.DocumentEdition))
    data.add((ID.focus, TOKG.predecessorEdition, ID.focus))
    violations = _find_sparql_violations(data)
    report = Graph()
    report_node = ID.validation_report
    report.add((report_node, RDF.type, SH.ValidationReport))
    report.add((report_node, SH.conforms, Literal(True)))

    combined = _merge_sparql_validation_results(
        report,
        core_conforms=True,
        violations=violations,
        guard_errors=[],
    )
    text = _combined_shacl_report_text(
        "Validation Report\nConforms: True\n",
        combined_conforms=combined,
        violations=violations,
        guard_errors=[],
    )

    assert not combined
    assert (report_node, SH.conforms, Literal(False)) in report
    assert any(report.objects(report_node, SH.result))
    assert "Conforms: False" in text
    assert _SPARQL_RULE_MESSAGES["document-edition-self-predecessor"] in text


def test_guard_failure_result_has_a_source_shape() -> None:
    report = Graph()
    report_node = ID.validation_report
    report.add((report_node, RDF.type, SH.ValidationReport))
    report.add((report_node, SH.conforms, Literal(True)))

    combined = _merge_sparql_validation_results(
        report,
        core_conforms=True,
        violations=[],
        guard_errors=["signature drift"],
    )

    result = next(report.objects(report_node, SH.result))
    assert not combined
    assert (result, SH.sourceShape, None) in report
