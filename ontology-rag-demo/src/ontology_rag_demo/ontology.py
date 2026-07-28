from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

import networkx as nx
from networkx.algorithms.approximation import steiner_tree
from rdflib import OWL, RDF, RDFS, SKOS, Graph, Literal, URIRef

from .ingestion import Chunk

ABBREVIATION_LOCAL_NAME = "abbreviation"
ENTITY_TYPES = {
    OWL.Class,
    OWL.ObjectProperty,
    OWL.DatatypeProperty,
    OWL.AnnotationProperty,
}
DIRECT_RELATIONS = {
    RDFS.subClassOf,
    RDFS.subPropertyOf,
    RDFS.domain,
    RDFS.range,
    OWL.equivalentClass,
    OWL.equivalentProperty,
    OWL.inverseOf,
}


@dataclass(frozen=True)
class GraphRetrievalResult:
    anchors: list[dict[str, str]]
    nodes: list[dict[str, object]]
    edges: list[dict[str, object]]
    disconnected: bool

    def as_dict(self) -> dict[str, object]:
        return {
            "anchors": self.anchors,
            "nodes": self.nodes,
            "edges": self.edges,
            "disconnected": self.disconnected,
        }

    def to_context(self) -> str:
        if not self.nodes:
            return "未从问题中识别到本体锚点。"
        node_lines = [
            f"- {node['label']} ({node['id']})"
            + (f": {node['comment']}" if node.get("comment") else "")
            for node in self.nodes
        ]
        edge_lines = [
            f"- {edge['source_label']} --[{', '.join(edge['relations'])}]--> {edge['target_label']}"
            for edge in self.edges
        ]
        sections = ["本体节点：", *node_lines]
        if edge_lines:
            sections.extend(["本体关系：", *edge_lines])
        if self.disconnected:
            sections.append("注意：识别到的锚点分布在不连通的子图中。")
        return "\n".join(sections)


class OntologyGraph:
    def __init__(self, rdf_graph: Graph) -> None:
        self.rdf_graph = rdf_graph
        self.graph = nx.Graph()
        self._aliases_by_node: dict[str, set[str]] = {}
        self._labels_by_node: dict[str, str] = {}
        self._comments_by_node: dict[str, str] = {}
        self._build()

    @classmethod
    def from_file(cls, path: Path) -> OntologyGraph:
        if not path.is_file():
            raise FileNotFoundError(f"Ontology file does not exist: {path}")
        rdf_graph = Graph()
        rdf_graph.parse(path)
        return cls(rdf_graph)

    @property
    def node_count(self) -> int:
        return self.graph.number_of_nodes()

    @property
    def edge_count(self) -> int:
        return self.graph.number_of_edges()

    def retrieve(
        self,
        question: str,
        *,
        max_anchors: int,
        max_nodes: int,
    ) -> GraphRetrievalResult:
        anchor_ids = self.extract_anchors(question, max_anchors=max_anchors)
        return self.retrieve_by_anchor_ids(anchor_ids, max_nodes=max_nodes)

    def retrieve_by_anchor_ids(
        self,
        anchor_ids: list[str],
        *,
        max_nodes: int,
    ) -> GraphRetrievalResult:
        """Return the minimum connecting subgraph for explicit ontology anchors."""

        validated_anchor_ids: list[str] = []
        for node_id in anchor_ids:
            if node_id in self.graph and node_id not in validated_anchor_ids:
                validated_anchor_ids.append(node_id)

        anchor_ids = validated_anchor_ids
        if not anchor_ids:
            return GraphRetrievalResult([], [], [], False)

        component_index: dict[str, int] = {}
        components = list(nx.connected_components(self.graph))
        for index, component in enumerate(components):
            for node_id in component:
                component_index[node_id] = index

        grouped: dict[int, list[str]] = {}
        for node_id in anchor_ids:
            grouped.setdefault(component_index[node_id], []).append(node_id)

        result_graph = nx.Graph()
        for component_id, terminals in grouped.items():
            component_graph = self.graph.subgraph(components[component_id])
            if len(terminals) == 1:
                partial = component_graph.subgraph(terminals)
            else:
                partial = steiner_tree(component_graph, terminals, weight="weight")
            result_graph = nx.compose(result_graph, partial)

        if result_graph.number_of_nodes() > max_nodes:
            keep = self._bounded_nodes(result_graph, anchor_ids, max_nodes)
            result_graph = result_graph.subgraph(keep).copy()

        anchors = [
            {"id": node_id, "label": self._labels_by_node[node_id]} for node_id in anchor_ids
        ]
        nodes = [
            {
                "id": node_id,
                "label": self._labels_by_node.get(node_id, _local_name(node_id)),
                "comment": self._comments_by_node.get(node_id, ""),
            }
            for node_id in sorted(result_graph.nodes)
        ]
        edges = []
        for source, target, data in sorted(result_graph.edges(data=True)):
            edges.append(
                {
                    "source": source,
                    "source_label": self._labels_by_node.get(source, _local_name(source)),
                    "target": target,
                    "target_label": self._labels_by_node.get(target, _local_name(target)),
                    "relations": sorted(data.get("relations", [])),
                }
            )
        return GraphRetrievalResult(
            anchors=anchors,
            nodes=nodes,
            edges=edges,
            disconnected=len(grouped) > 1,
        )

    def extract_anchors(self, question: str, *, max_anchors: int) -> list[str]:
        normalized_question = _normalize(question)
        candidates: list[tuple[int, str, str]] = []
        for node_id, aliases in self._aliases_by_node.items():
            for alias in aliases:
                normalized_alias = _normalize(alias)
                if len(normalized_alias) >= 2 and normalized_alias in normalized_question:
                    candidates.append((len(normalized_alias), alias, node_id))

        candidates.sort(key=lambda item: (-item[0], item[1].casefold(), item[2]))
        selected: list[str] = []
        for _, _, node_id in candidates:
            if node_id not in selected:
                selected.append(node_id)
            if len(selected) >= max_anchors:
                break
        return selected

    def entity_chunks(self) -> list[Chunk]:
        chunks = []
        for index, node_id in enumerate(sorted(self._labels_by_node)):
            name = _local_name(node_id)
            label = self._labels_by_node[node_id]
            comment = self._comments_by_node.get(node_id, "")
            text = f"{name}\n{label}\n{comment}"
            chunks.append(
                Chunk(
                    id=node_id,
                    text=text,
                    source="ontology.ttl",
                    chunk_index=index,
                    content_type="ontology_entity",
                )
            )
        return chunks

    def _build(self) -> None:
        entity_ids: set[str] = set()
        for subject, entity_type in self.rdf_graph.subject_objects(RDF.type):
            if isinstance(subject, URIRef) and entity_type in ENTITY_TYPES:
                entity_ids.add(str(subject))

        for subject, predicate, obj in self.rdf_graph:
            if predicate in DIRECT_RELATIONS:
                if isinstance(subject, URIRef):
                    entity_ids.add(str(subject))
                if isinstance(obj, URIRef):
                    entity_ids.add(str(obj))

        for node_id in entity_ids:
            node = URIRef(node_id)
            aliases = {_local_name(node_id)}
            labels = [
                str(value)
                for predicate in (RDFS.label, SKOS.prefLabel, SKOS.altLabel)
                for value in self.rdf_graph.objects(node, predicate)
                if isinstance(value, Literal)
            ]
            abbreviations = [
                str(value)
                for predicate, value in self.rdf_graph.predicate_objects(node)
                if _local_name(str(predicate)) == ABBREVIATION_LOCAL_NAME
                and isinstance(value, Literal)
            ]
            aliases.update(labels)
            aliases.update(abbreviations)
            label = labels[0] if labels else _local_name(node_id)
            comments = [
                str(value)
                for value in self.rdf_graph.objects(node, RDFS.comment)
                if isinstance(value, Literal)
            ]
            self.graph.add_node(node_id)
            self._aliases_by_node[node_id] = {alias for alias in aliases if alias.strip()}
            self._labels_by_node[node_id] = label
            self._comments_by_node[node_id] = comments[0] if comments else ""

        for subject, predicate, obj in self.rdf_graph:
            if (
                predicate in DIRECT_RELATIONS
                and isinstance(subject, URIRef)
                and isinstance(obj, URIRef)
                and str(subject) in entity_ids
                and str(obj) in entity_ids
            ):
                self._add_edge(str(subject), str(obj), _local_name(str(predicate)))

        for relation in self.rdf_graph.subjects(RDF.type, OWL.ObjectProperty):
            if not isinstance(relation, URIRef):
                continue
            domains = [
                str(value)
                for value in self.rdf_graph.objects(relation, RDFS.domain)
                if isinstance(value, URIRef) and str(value) in entity_ids
            ]
            ranges = [
                str(value)
                for value in self.rdf_graph.objects(relation, RDFS.range)
                if isinstance(value, URIRef) and str(value) in entity_ids
            ]
            for domain in domains:
                for range_id in ranges:
                    self._add_edge(domain, range_id, _local_name(str(relation)))

    def _add_edge(self, source: str, target: str, relation: str) -> None:
        if self.graph.has_edge(source, target):
            self.graph[source][target].setdefault("relations", set()).add(relation)
        else:
            self.graph.add_edge(source, target, relations={relation}, weight=1)

    @staticmethod
    def _bounded_nodes(
        graph: nx.Graph,
        anchors: list[str],
        max_nodes: int,
    ) -> set[str]:
        keep = set(anchors[:max_nodes])
        for anchor in anchors:
            if anchor not in graph:
                continue
            for node_id in nx.bfs_tree(graph, anchor):
                keep.add(node_id)
                if len(keep) >= max_nodes:
                    return keep
        return keep


def _local_name(iri: str) -> str:
    return unquote(iri.rsplit("#", 1)[-1].rsplit("/", 1)[-1])


def _normalize(value: str) -> str:
    return re.sub(r"[\W_]+", "", value.casefold(), flags=re.UNICODE)
