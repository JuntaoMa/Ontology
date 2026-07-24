from pathlib import Path

import pytest
from pyshacl import validate
from rdflib import DCTERMS, OWL, RDF, RDFS, SKOS, Graph, Namespace, URIRef
from rdflib.namespace import SH


ROOT = Path(__file__).resolve().parents[1]
CORE_PATH = ROOT / "ontology" / "core.ttl"
VOCAB_PATH = ROOT / "ontology" / "vocabularies.ttl"
SHAPES_PATH = ROOT / "shapes" / "tokg-shapes.ttl"

TOKG = Namespace("https://example.org/tokg/ontology#")
ID = Namespace("https://example.org/tokg/id/")
PROV = Namespace("http://www.w3.org/ns/prov#")


def load_graph(*paths: Path) -> Graph:
    graph = Graph()
    for path in paths:
        graph.parse(path, format="turtle")
    return graph


@pytest.fixture(scope="module")
def ontology_graph() -> Graph:
    return load_graph(CORE_PATH, VOCAB_PATH)


@pytest.fixture(scope="module")
def shapes_graph() -> Graph:
    return load_graph(SHAPES_PATH)


def run_validation(data: str, ontology_graph: Graph, shapes_graph: Graph):
    data_graph = Graph().parse(data=data, format="turtle")
    # Controlled vocabulary individuals are part of the validation dataset,
    # while the same graph also supplies the RDFS/OWL schema to pySHACL.
    data_graph += ontology_graph
    conforms, report_graph, report_text = validate(
        data_graph=data_graph,
        shacl_graph=shapes_graph,
        ont_graph=ontology_graph,
        inference="rdfs",
        advanced=True,
        meta_shacl=True,
    )
    return conforms, report_graph, report_text


def focus_nodes(report_graph: Graph) -> set[URIRef]:
    return {node for node in report_graph.objects(None, SH.focusNode) if isinstance(node, URIRef)}


def test_derived_assertion_requires_derivation_rule(
    ontology_graph: Graph, shapes_graph: Graph
) -> None:
    data = VALID_DATA.replace(
        "tokg:assertionModality id:assertion-modality-asserted",
        "tokg:assertionModality id:assertion-modality-derived",
    )
    conforms, _, report_text = run_validation(data, ontology_graph, shapes_graph)
    assert not conforms
    assert "derivation rule" in report_text


def test_support_link_must_point_back_to_the_assertion(
    ontology_graph: Graph, shapes_graph: Graph
) -> None:
    data = VALID_DATA.replace(
        "tokg:forAssertion <https://example.org/tokg/id/assertion/sha256/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee>",
        "tokg:forAssertion id:other-assertion",
    )
    conforms, _, report_text = run_validation(data, ontology_graph, shapes_graph)
    assert not conforms
    assert "referenced by its declared assertion" in report_text


VALID_DATA = """
@prefix id: <https://example.org/tokg/id/> .
@prefix tokg: <https://example.org/tokg/ontology#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

id:org-3gpp a tokg:StandardBody .
id:doc-23-501 a tokg:DocumentFamily ;
  tokg:standardBody id:org-3gpp ;
  tokg:documentType "TS" ;
  tokg:documentNumber "23.501" ;
  dcterms:title "Example system architecture"@en .

id:edition-23-501-v18-7-0-en a tokg:DocumentEdition ;
  tokg:editionOf id:doc-23-501 ;
  tokg:versionString "18.7.0" ;
  tokg:release id:release-18 ;
  tokg:language "en"^^xsd:language ;
  tokg:approvalDate "2026-01-01"^^xsd:date ;
  tokg:lifecycleStatus id:lifecycle-in-force .

<https://example.org/tokg/id/artifact/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>
  a tokg:DocumentArtifact ;
  tokg:artifactOfEdition id:edition-23-501-v18-7-0-en ;
  tokg:sourceUrl "https://example.org/spec.pdf"^^xsd:anyURI ;
  tokg:retrievedAt "2026-07-20T10:00:00Z"^^xsd:dateTime ;
  tokg:mediaType "application/pdf" ;
  tokg:byteSize "1000"^^xsd:nonNegativeInteger ;
  tokg:sha256 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" .

id:part-6-1 a tokg:DocumentPart ;
  tokg:partOfArtifact <https://example.org/tokg/id/artifact/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa> ;
  tokg:partKind "clause" ;
  tokg:canonicalLocator "6.1" ;
  tokg:normativeStatus id:normative .

<https://example.org/tokg/id/evidence/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb>
  a tokg:EvidenceSpan ;
  tokg:evidenceArtifact <https://example.org/tokg/id/artifact/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa> ;
  tokg:evidencePart id:part-6-1 ;
  tokg:locatorText "6.1, paragraph 2" ;
  tokg:fragmentIdentifier "fragment-6-1-paragraph-2" ;
  tokg:exactQuote "Example evidence" ;
  tokg:exactTextSha256 "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" ;
  tokg:normalizedTextSha256 "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" ;
  tokg:startChar "10"^^xsd:nonNegativeInteger ;
  tokg:endChar "26"^^xsd:positiveInteger .

id:run-1 a tokg:ExtractionActivity .

<https://example.org/tokg/id/assertion/sha256/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee>
  a tokg:Assertion ;
  tokg:assertionSubject id:procedure-registration ;
  tokg:assertionPredicate tokg:hasStep ;
  tokg:assertionObject id:step-1 ;
  tokg:polarity id:polarity-positive ;
  tokg:assertionModality id:assertion-modality-asserted ;
  tokg:assertionStatus id:assertion-status-accepted ;
  tokg:confidence "0.98"^^xsd:decimal ;
  tokg:applicabilityScope id:baseline-test ;
  tokg:generatedBy id:run-1 ;
  tokg:hasAssertionEvidence id:support-1 .

id:support-1 a tokg:AssertionEvidence ;
  tokg:forAssertion <https://example.org/tokg/id/assertion/sha256/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee> ;
  tokg:evidenceSpan <https://example.org/tokg/id/evidence/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb> ;
  tokg:evidenceRole id:evidence-role-supports ;
  tokg:evidenceDirectness id:evidence-explicit ;
  tokg:generatedBy id:run-1 .

id:nf-ue a tokg:NetworkElementType ; tokg:canonicalKey "network-element:ue" .
id:nf-amf a tokg:NetworkFunctionType ; tokg:canonicalKey "network-function:amf" .
id:role-ue a tokg:ParticipantRole, tokg:InterfaceEndpointRole ;
  tokg:canonicalKey "role:ue" ;
  tokg:participantType id:nf-ue ;
  tokg:endpointType id:nf-ue ;
  tokg:direction id:direction-bidirectional .
id:role-amf a tokg:ParticipantRole, tokg:InterfaceEndpointRole ;
  tokg:canonicalKey "role:amf" ;
  tokg:participantType id:nf-amf ;
  tokg:endpointType id:nf-amf ;
  tokg:direction id:direction-bidirectional .

id:protocol-nas a tokg:Protocol ; tokg:canonicalKey "protocol:3gpp:nas" .
id:layer-nas a tokg:ProtocolLayer ; tokg:canonicalKey "protocol-layer:nas" .
id:interface-n1 a tokg:Interface ;
  tokg:canonicalKey "interface:n1" ;
  tokg:hasEndpointRole id:role-ue, id:role-amf ;
  tokg:hasProtocolBinding id:binding-n1-nas .
id:binding-n1-nas a tokg:ProtocolBinding ;
  tokg:bindingForInterface id:interface-n1 ;
  tokg:bindsProtocol id:protocol-nas ;
  tokg:atLayer id:layer-nas .

id:message-registration-request a tokg:Message ;
  tokg:canonicalKey "message:nas:registration-request" ;
  tokg:definedByProtocol id:protocol-nas ;
  tokg:hasIEUsage id:usage-registration-type .
id:ie-registration-type a tokg:InformationElement ;
  tokg:canonicalKey "ie:nas:registration-type" .
id:usage-registration-type a tokg:IEUsage ;
  tokg:usageMessage id:message-registration-request ;
  tokg:usesIE id:ie-registration-type ;
  tokg:presence id:presence-optional ;
  tokg:minOccurs "0"^^xsd:nonNegativeInteger ;
  tokg:maxOccurs "1"^^xsd:nonNegativeInteger .

id:procedure-registration a tokg:Procedure ;
  tokg:canonicalKey "procedure:registration" ;
  tokg:hasVariant id:variant-registration-initial .
id:variant-registration-initial a tokg:ProcedureVariant ;
  tokg:canonicalKey "procedure-variant:registration:initial" ;
  tokg:variantOf id:procedure-registration ;
  tokg:hasStep id:step-1, id:step-2 .
id:step-1 a tokg:ProcedureStep ;
  tokg:canonicalKey "procedure-step:registration:1" ;
  tokg:inProcedure id:variant-registration-initial ;
  tokg:stepKey "registration-request" ;
  tokg:stepIndex "1"^^xsd:positiveInteger ;
  tokg:hasMessageExchange id:exchange-1 .
id:step-2 a tokg:ProcedureStep ;
  tokg:canonicalKey "procedure-step:registration:2" ;
  tokg:inProcedure id:variant-registration-initial ;
  tokg:stepKey "registration-response" ;
  tokg:stepIndex "2"^^xsd:positiveInteger .
id:edge-1 a tokg:FlowEdge ;
  tokg:fromStep id:step-1 ;
  tokg:toStep id:step-2 ;
  tokg:outcome id:outcome-success .
id:exchange-1 a tokg:MessageExchange ;
  tokg:inStep id:step-1 ;
  tokg:senderRole id:role-ue ;
  tokg:receiverRole id:role-amf ;
  tokg:exchangeMessage id:message-registration-request ;
  tokg:overInterface id:interface-n1 .

id:service-registration a tokg:Service ; tokg:canonicalKey "service:registration" .
id:counter-attempts a tokg:CounterDefinition ;
  tokg:canonicalKey "counter:registration-attempts" ;
  tokg:unit "count" ;
  tokg:measurementObject id:nf-amf ;
  tokg:aggregationWindow "PT15M"^^xsd:duration .
id:formula-success-rate a tokg:Formula ;
  tokg:formulaExpression "successes / attempts * 100" ;
  tokg:formulaLanguage "infix" ;
  tokg:formulaNormative true ;
  tokg:hasOperand id:operand-attempts .
id:operand-attempts a tokg:FormulaOperand ;
  tokg:operandOf id:formula-success-rate ;
  tokg:referencesMetric id:counter-attempts ;
  tokg:operandRole "denominator" .
id:kpi-registration-success a tokg:KPI ;
  tokg:canonicalKey "kpi:registration-success-rate" ;
  tokg:hasFormula id:formula-success-rate ;
  tokg:unit "percent" ;
  tokg:measurementObject id:nf-amf ;
  tokg:aggregationWindow "PT15M"^^xsd:duration ;
  tokg:aggregationFunction id:aggregation-ratio ;
  tokg:zeroDenominatorPolicy id:zero-policy-null .
id:kqi-registration-experience a tokg:KQI ;
  tokg:canonicalKey "kqi:registration-experience" ;
  tokg:hasFormula id:formula-success-rate ;
  tokg:unit "score" ;
  tokg:aggregationWindow "PT15M"^^xsd:duration ;
  tokg:measuresService id:service-registration ;
  tokg:dependsOnMetric id:kpi-registration-success .

id:alarm-amf-unavailable a tokg:AlarmDefinition ;
  tokg:canonicalKey "alarm:amf-unavailable" ;
  tokg:alarmCode "AMF-001" ;
  tokg:perceivedSeverity id:severity-critical .
id:dependency-registration-amf a tokg:Dependency ;
  tokg:dependencySource id:service-registration ;
  tokg:dependencyTarget id:nf-amf ;
  tokg:dependencyType id:dependency-availability ;
  tokg:dependencyStrength "1.0"^^xsd:decimal .

id:baseline-rel18 a tokg:Baseline ;
  tokg:targetRelease id:release-18 ;
  tokg:hasBaselineItem id:baseline-item-23-501 .
id:baseline-item-23-501 a tokg:BaselineItem ;
  tokg:inBaseline id:baseline-rel18 ;
  tokg:documentFamily id:doc-23-501 ;
  tokg:selectedEdition id:edition-23-501-v18-7-0-en ;
  tokg:inclusionType "normative" .
"""


def test_turtle_files_parse_and_declare_expected_schema(ontology_graph: Graph, shapes_graph: Graph):
    expected_classes = {
        TOKG.Domain,
        TOKG.Technology,
        TOKG.NetworkElement,
        TOKG.NetworkFunction,
        TOKG.Function,
        TOKG.Interface,
        TOKG.Protocol,
        TOKG.Procedure,
        TOKG.ProcedureStep,
        TOKG.Message,
        TOKG.InformationElement,
        TOKG.Timer,
        TOKG.Cause,
        TOKG.Alarm,
        TOKG.Counter,
        TOKG.KPI,
        TOKG.KQI,
        TOKG.Service,
        TOKG.Dependency,
        TOKG.Transport,
        TOKG.Requirement,
        TOKG.Assertion,
        TOKG.DocumentArtifact,
        TOKG.EvidenceSpan,
        TOKG.Baseline,
    }
    expected_properties = {
        TOKG.hasEndpointRole,
        TOKG.bindsProtocol,
        TOKG.hasStep,
        TOKG.exchangeMessage,
        TOKG.hasIEUsage,
        TOKG.hasFormula,
        TOKG.dependsOnMetric,
        TOKG.assertionSubject,
        TOKG.assertionPredicate,
        TOKG.assertionObject,
        TOKG.evidenceSpan,
        TOKG.hasBaselineItem,
    }
    expected_shapes = {
        TOKG.AssertionShape,
        TOKG.DocumentArtifactShape,
        TOKG.EvidenceSpanShape,
        TOKG.ProcedureShape,
        TOKG.ProcedureStepShape,
        TOKG.MessageExchangeShape,
        TOKG.MessageShape,
        TOKG.IEUsageShape,
        TOKG.KPIShape,
        TOKG.KQIShape,
        TOKG.AlarmDefinitionShape,
        TOKG.DependencyShape,
        TOKG.BaselineShape,
    }

    assert expected_classes <= set(ontology_graph.subjects(RDF.type, OWL.Class))
    declared_properties = set(ontology_graph.subjects(RDF.type, OWL.ObjectProperty)) | set(
        ontology_graph.subjects(RDF.type, OWL.DatatypeProperty)
    )
    assert expected_properties <= declared_properties
    assert expected_shapes <= set(shapes_graph.subjects(RDF.type, SH.NodeShape))


def test_standard_vocabulary_alignments(ontology_graph: Graph):
    assert (TOKG.Concept, RDFS.subClassOf, SKOS.Concept) in ontology_graph
    assert (TOKG.DocumentFamily, RDFS.subClassOf, DCTERMS.BibliographicResource) in ontology_graph
    assert (TOKG.DocumentArtifact, RDFS.subClassOf, PROV.Entity) in ontology_graph
    assert (TOKG.ExtractionActivity, RDFS.subClassOf, PROV.Activity) in ontology_graph
    assert (TOKG.predecessorEdition, RDFS.subPropertyOf, PROV.wasRevisionOf) in ontology_graph
    assert (TOKG.generatedBy, RDFS.subPropertyOf, PROV.wasGeneratedBy) in ontology_graph


def test_controlled_vocabularies_have_stable_identity(ontology_graph: Graph):
    required_values = {
        ID["domain-4g"],
        ID["domain-5g"],
        ID["domain-ims"],
        ID["presence-mandatory"],
        ID["assertion-modality-derived"],
        ID["evidence-role-supports"],
        ID["dependency-transport"],
        ID["requirement-shall"],
        ID["release-18"],
    }
    for value in required_values:
        assert (value, TOKG.canonicalKey, None) in ontology_graph
        assert (value, SKOS.prefLabel, None) in ontology_graph


def test_valid_integrated_graph_conforms(ontology_graph: Graph, shapes_graph: Graph):
    conforms, _, report_text = run_validation(VALID_DATA, ontology_graph, shapes_graph)
    assert conforms, report_text


def test_assertion_requires_exclusive_object_and_supporting_evidence(
    ontology_graph: Graph, shapes_graph: Graph
):
    data = """
    @prefix id: <https://example.org/tokg/id/> .
    @prefix tokg: <https://example.org/tokg/ontology#> .
    id:run a tokg:ExtractionActivity .
    <https://example.org/tokg/id/assertion/sha256/1111111111111111111111111111111111111111111111111111111111111111>
      a tokg:Assertion ;
      tokg:assertionSubject id:subject ;
      tokg:assertionPredicate tokg:hasStep ;
      tokg:assertionObject id:object ;
      tokg:literalObject "also a literal" ;
      tokg:polarity id:polarity-positive ;
      tokg:assertionModality id:assertion-modality-asserted ;
      tokg:assertionStatus id:assertion-status-accepted ;
      tokg:generatedBy id:run .
    """
    conforms, _, report_text = run_validation(data, ontology_graph, shapes_graph)
    assert not conforms
    assert "supporting evidence" in report_text


def test_artifact_and_evidence_integrity_rules_reject_bad_data(
    ontology_graph: Graph, shapes_graph: Graph
):
    data = """
    @prefix id: <https://example.org/tokg/id/> .
    @prefix tokg: <https://example.org/tokg/ontology#> .
    @prefix dcterms: <http://purl.org/dc/terms/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    id:org a tokg:StandardBody .
    id:doc a tokg:DocumentFamily ; tokg:standardBody id:org ; tokg:documentType "TS" ;
      tokg:documentNumber "00.000" ; dcterms:title "Test" .
    id:edition a tokg:DocumentEdition ; tokg:editionOf id:doc ; tokg:versionString "1.0.0" ;
      tokg:language "en"^^xsd:language ; tokg:lifecycleStatus id:lifecycle-draft .
    <https://example.org/tokg/id/artifact/sha256/2222222222222222222222222222222222222222222222222222222222222222>
      a tokg:DocumentArtifact ; tokg:artifactOfEdition id:edition ;
      tokg:sourceUrl "https://example.org/test.pdf"^^xsd:anyURI ;
      tokg:retrievedAt "2026-07-20T00:00:00Z"^^xsd:dateTime ;
      tokg:mediaType "application/pdf" ; tokg:byteSize "1"^^xsd:nonNegativeInteger ;
      tokg:sha256 "NOT-A-HASH" .
    <https://example.org/tokg/id/evidence/sha256/3333333333333333333333333333333333333333333333333333333333333333>
      a tokg:EvidenceSpan ;
      tokg:evidenceArtifact <https://example.org/tokg/id/artifact/sha256/2222222222222222222222222222222222222222222222222222222222222222> ;
      tokg:normalizedTextSha256 "4444444444444444444444444444444444444444444444444444444444444444" ;
      tokg:startChar "20"^^xsd:nonNegativeInteger ; tokg:endChar "10"^^xsd:positiveInteger .
    """
    conforms, _, report_text = run_validation(data, ontology_graph, shapes_graph)
    assert not conforms
    assert "Artifact SHA-256" in report_text
    assert "smaller than endChar" in report_text


def test_procedure_step_indices_are_unique(ontology_graph: Graph, shapes_graph: Graph):
    data = """
    @prefix id: <https://example.org/tokg/id/> .
    @prefix tokg: <https://example.org/tokg/ontology#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    id:p a tokg:Procedure ; tokg:canonicalKey "procedure:p" ; tokg:hasVariant id:v .
    id:v a tokg:ProcedureVariant ; tokg:canonicalKey "variant:v" ;
      tokg:variantOf id:p ; tokg:hasStep id:s1, id:s2 .
    id:s1 a tokg:ProcedureStep ; tokg:canonicalKey "step:s1" ; tokg:inProcedure id:v ;
      tokg:stepKey "one" ; tokg:stepIndex "1"^^xsd:positiveInteger .
    id:s2 a tokg:ProcedureStep ; tokg:canonicalKey "step:s2" ; tokg:inProcedure id:v ;
      tokg:stepKey "two" ; tokg:stepIndex "1"^^xsd:positiveInteger .
    """
    conforms, _, report_text = run_validation(data, ontology_graph, shapes_graph)
    assert not conforms
    assert "stepIndex must be unique" in report_text


def test_conditional_ie_usage_requires_condition(ontology_graph: Graph, shapes_graph: Graph):
    data = """
    @prefix id: <https://example.org/tokg/id/> .
    @prefix tokg: <https://example.org/tokg/ontology#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    id:protocol a tokg:Protocol ; tokg:canonicalKey "protocol:test" .
    id:message a tokg:Message ; tokg:canonicalKey "message:test" ;
      tokg:definedByProtocol id:protocol ; tokg:hasIEUsage id:usage .
    id:ie a tokg:InformationElement ; tokg:canonicalKey "ie:test" .
    id:usage a tokg:IEUsage ; tokg:usageMessage id:message ; tokg:usesIE id:ie ;
      tokg:presence id:presence-conditional ; tokg:minOccurs "0"^^xsd:nonNegativeInteger ;
      tokg:maxOccurs "1"^^xsd:nonNegativeInteger .
    """
    conforms, _, report_text = run_validation(data, ontology_graph, shapes_graph)
    assert not conforms
    assert "Conditional IE usage" in report_text


@pytest.mark.parametrize(
    ("focus", "data"),
    [
        (
            ID["bad-kpi"],
            """
            @prefix id: <https://example.org/tokg/id/> .
            @prefix tokg: <https://example.org/tokg/ontology#> .
            id:bad-kpi a tokg:KPI ; tokg:canonicalKey "kpi:bad" .
            """,
        ),
        (
            ID["bad-kqi"],
            """
            @prefix id: <https://example.org/tokg/id/> .
            @prefix tokg: <https://example.org/tokg/ontology#> .
            id:bad-kqi a tokg:KQI ; tokg:canonicalKey "kqi:bad" .
            """,
        ),
        (
            ID["bad-alarm"],
            """
            @prefix id: <https://example.org/tokg/id/> .
            @prefix tokg: <https://example.org/tokg/ontology#> .
            id:bad-alarm a tokg:AlarmDefinition ; tokg:canonicalKey "alarm:bad" ;
              tokg:perceivedSeverity id:severity-major .
            """,
        ),
        (
            ID["bad-dependency"],
            """
            @prefix id: <https://example.org/tokg/id/> .
            @prefix tokg: <https://example.org/tokg/ontology#> .
            id:bad-dependency a tokg:Dependency ; tokg:dependencySource id:same ;
              tokg:dependencyTarget id:same ; tokg:dependencyType id:dependency-hosting .
            """,
        ),
    ],
)
def test_key_operations_shapes_reject_incomplete_or_inconsistent_nodes(
    focus: URIRef, data: str, ontology_graph: Graph, shapes_graph: Graph
):
    conforms, report_graph, _ = run_validation(data, ontology_graph, shapes_graph)
    assert not conforms
    assert focus in focus_nodes(report_graph)


def test_baseline_rejects_duplicate_main_editions(ontology_graph: Graph, shapes_graph: Graph):
    data = """
    @prefix id: <https://example.org/tokg/id/> .
    @prefix tokg: <https://example.org/tokg/ontology#> .
    @prefix dcterms: <http://purl.org/dc/terms/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    id:org a tokg:StandardBody .
    id:doc a tokg:DocumentFamily ; tokg:standardBody id:org ; tokg:documentType "TS" ;
      tokg:documentNumber "00.001" ; dcterms:title "Test" .
    id:e1 a tokg:DocumentEdition ; tokg:editionOf id:doc ; tokg:versionString "18.1.0" ;
      tokg:language "en"^^xsd:language ; tokg:lifecycleStatus id:lifecycle-in-force .
    id:e2 a tokg:DocumentEdition ; tokg:editionOf id:doc ; tokg:versionString "18.2.0" ;
      tokg:language "en"^^xsd:language ; tokg:lifecycleStatus id:lifecycle-in-force .
    id:baseline a tokg:Baseline ; tokg:targetRelease id:release-18 ;
      tokg:hasBaselineItem id:i1, id:i2 .
    id:i1 a tokg:BaselineItem ; tokg:inBaseline id:baseline ; tokg:documentFamily id:doc ;
      tokg:selectedEdition id:e1 ; tokg:inclusionType "normative" .
    id:i2 a tokg:BaselineItem ; tokg:inBaseline id:baseline ; tokg:documentFamily id:doc ;
      tokg:selectedEdition id:e2 ; tokg:inclusionType "normative" .
    """
    conforms, _, report_text = run_validation(data, ontology_graph, shapes_graph)
    assert not conforms
    assert "only one main edition" in report_text
