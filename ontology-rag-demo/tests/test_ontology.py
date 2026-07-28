from pathlib import Path

from ontology_rag_demo.ontology import OntologyGraph

FIXTURE = Path(__file__).parents[1] / "examples" / "smart-building" / "ontology.ttl"


def test_extracts_anchors_and_connecting_subgraph() -> None:
    ontology = OntologyGraph.from_file(FIXTURE)

    result = ontology.retrieve(
        "温度传感器位于哪个建筑？",
        max_anchors=6,
        max_nodes=20,
    )

    assert {
        "温度传感器",
        "建筑",
    } <= {anchor["label"] for anchor in result.anchors}
    assert any(node["id"].endswith("#locatedIn") for node in result.nodes)
    relations = {relation for edge in result.edges for relation in edge["relations"]}
    assert {"subClassOf", "domain", "range", "partOfBuilding"} <= relations
    assert result.disconnected is False


def test_returns_empty_result_without_anchor() -> None:
    ontology = OntologyGraph.from_file(FIXTURE)

    result = ontology.retrieve("完全不相关的问题", max_anchors=4, max_nodes=20)

    assert result.nodes == []
    assert result.edges == []
