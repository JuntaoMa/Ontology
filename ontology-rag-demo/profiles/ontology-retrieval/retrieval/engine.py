from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import unquote

import lancedb
import networkx as nx
import numpy as np
import pyarrow as pa
from networkx.algorithms.approximation import steiner_tree
from numpy.typing import NDArray
from rdflib import OWL, RDF, RDFS, SKOS, Graph, Literal, URIRef

INDEX_SCHEMA_VERSION = 1
INDEX_DIRECTORY = "retrieval"
INDEX_METADATA_FILE = "metadata.json"
LANCEDB_DIRECTORY = "lancedb"
LANCEDB_TABLE = "ontology_entities"
GRAPH_ALGORITHM = "minimum_connected_subgraph"
GRAPH_IMPLEMENTATION = "networkx.approximation.steiner_tree:mehlhorn"
DEFAULT_TOP_K = 5
DEFAULT_GRAPH_MAX_NODES = 80
MAX_TOP_K = 20
MAX_GRAPH_NODES = 200
VALID_BACKENDS = {"deterministic", "bge-m3"}

ENTITY_TYPES = {
    OWL.Class: "Class",
    RDFS.Class: "Class",
    OWL.ObjectProperty: "ObjectProperty",
    OWL.DatatypeProperty: "DatatypeProperty",
    OWL.AnnotationProperty: "AnnotationProperty",
    RDF.Property: "Property",
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
class EntityRecord:
    id: str
    name: str
    label: str
    comment: str
    entity_type: str

    @property
    def embedding_text(self) -> str:
        return f"{self.name}\n{self.label}\n{self.comment}"


@dataclass(frozen=True)
class EmbeddingConfig:
    backend: str
    model: str
    max_length: int
    normalize: bool

    @classmethod
    def from_environment(cls) -> EmbeddingConfig:
        backend = os.environ.get("EMBEDDING_BACKEND", "deterministic").strip().lower()
        if backend not in VALID_BACKENDS:
            raise RuntimeError(
                "EMBEDDING_BACKEND must be either deterministic or bge-m3"
            )
        model = (
            "deterministic-hash-v1"
            if backend == "deterministic"
            else os.environ.get("EMBEDDING_MODEL", "BAAI/bge-m3").strip()
        )
        if not model:
            raise RuntimeError("EMBEDDING_MODEL cannot be empty")
        max_length = positive_environment_integer("EMBEDDING_MAX_LENGTH", 512, 8192)
        normalize = boolean_environment_value("EMBEDDING_NORMALIZE", True)
        return cls(
            backend=backend,
            model=model,
            max_length=max_length,
            normalize=normalize,
        )


@dataclass(frozen=True)
class IndexMetadata:
    schema_version: int
    ontology_sha256: str
    ontology_file: str
    entity_count: int
    vector_dimension: int
    embedding_backend: str
    embedding_model: str
    embedding_max_length: int
    embedding_normalize: bool
    vector_top_k: int
    graph_algorithm: str
    graph_implementation: str
    graph_max_nodes: int
    lancedb_table: str

    @classmethod
    def load(cls, path: Path) -> IndexMetadata:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as error:
            raise RuntimeError("retrieval index metadata is missing") from error
        except json.JSONDecodeError as error:
            raise RuntimeError("retrieval index metadata is invalid JSON") from error
        if not isinstance(payload, dict):
            raise RuntimeError("retrieval index metadata must be a JSON object")
        try:
            metadata = cls(**payload)
        except TypeError as error:
            raise RuntimeError("retrieval index metadata has an invalid schema") from error
        metadata.validate()
        return metadata

    def validate(self) -> None:
        if self.schema_version != INDEX_SCHEMA_VERSION:
            raise RuntimeError("retrieval index schema version is unsupported")
        if not is_sha256(self.ontology_sha256):
            raise RuntimeError("retrieval index ontology digest is invalid")
        if self.embedding_backend not in VALID_BACKENDS:
            raise RuntimeError("retrieval index embedding backend is unsupported")
        if self.graph_algorithm != GRAPH_ALGORITHM:
            raise RuntimeError("retrieval index graph algorithm is unsupported")
        if self.graph_implementation != GRAPH_IMPLEMENTATION:
            raise RuntimeError("retrieval index graph implementation is unsupported")
        if not 1 <= self.vector_top_k <= MAX_TOP_K:
            raise RuntimeError("retrieval index top-k is invalid")
        if not 1 <= self.graph_max_nodes <= MAX_GRAPH_NODES:
            raise RuntimeError("retrieval index graph node limit is invalid")
        if self.vector_dimension <= 0 or self.entity_count <= 0:
            raise RuntimeError("retrieval index dimensions are invalid")


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


class Embedder(Protocol):
    @property
    def dimension(self) -> int: ...

    def encode(self, texts: list[str]) -> NDArray[np.float32]: ...


class DeterministicEmbedder:
    """Offline plumbing embedder; it is not intended for retrieval quality tests."""

    def __init__(self, dimension: int = 64) -> None:
        self._dimension = dimension

    @property
    def dimension(self) -> int:
        return self._dimension

    def encode(self, texts: list[str]) -> NDArray[np.float32]:
        vectors = np.zeros((len(texts), self.dimension), dtype=np.float32)
        for row, text in enumerate(texts):
            tokens = re.findall(r"[\w-]+", text.casefold(), flags=re.UNICODE)
            for token in tokens:
                digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
                index = int.from_bytes(digest[:4], "big") % self.dimension
                sign = 1.0 if digest[4] & 1 else -1.0
                vectors[row, index] += sign
            norm = float(np.linalg.norm(vectors[row]))
            if norm == 0:
                vectors[row, 0] = 1.0
            else:
                vectors[row] /= norm
        return vectors


class BgeM3Embedder:
    def __init__(self, config: EmbeddingConfig) -> None:
        self.config = config
        self._model = None
        self._dimension = 1024

    @property
    def dimension(self) -> int:
        return self._dimension

    def _load(self):
        if self._model is not None:
            return self._model

        device = os.environ.get("EMBEDDING_DEVICE", "cpu").strip().lower() or "cpu"
        if device not in {"cpu", "mps"}:
            raise RuntimeError("EMBEDDING_DEVICE must be cpu or mps")
        if device == "mps":
            import torch

            if not torch.backends.mps.is_available():
                raise RuntimeError("EMBEDDING_DEVICE=mps requested but MPS is unavailable")

        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(self.config.model, device=device)
        model.max_seq_length = self.config.max_length
        dimension = model.get_embedding_dimension()
        if dimension is not None:
            self._dimension = int(dimension)
        self._model = model
        return model

    def encode(self, texts: list[str]) -> NDArray[np.float32]:
        if not texts:
            return np.empty((0, self.dimension), dtype=np.float32)
        batch_size = positive_environment_integer("EMBEDDING_BATCH_SIZE", 2, 512)
        vectors = self._load().encode(
            texts,
            batch_size=batch_size,
            convert_to_numpy=True,
            normalize_embeddings=self.config.normalize,
            show_progress_bar=len(texts) > batch_size,
        )
        return np.asarray(vectors, dtype=np.float32)


class OntologyGraph:
    def __init__(self, graph: Graph) -> None:
        self.rdf_graph = graph
        self.graph = nx.Graph()
        self.records_by_id: dict[str, EntityRecord] = {}
        self._build()

    @classmethod
    def from_file(cls, path: Path) -> OntologyGraph:
        if not path.is_file():
            raise RuntimeError("Runtime ontology snapshot is missing")
        graph = Graph()
        graph.parse(path)
        return cls(graph)

    def entity_records(self) -> list[EntityRecord]:
        return [self.records_by_id[node_id] for node_id in sorted(self.records_by_id)]

    def retrieve_by_anchor_ids(
        self,
        anchor_ids: list[str],
        *,
        max_nodes: int,
    ) -> GraphRetrievalResult:
        anchors = []
        for node_id in anchor_ids:
            if node_id in self.graph and node_id not in anchors:
                anchors.append(node_id)
        if not anchors:
            return GraphRetrievalResult([], [], [], False)

        components = list(nx.connected_components(self.graph))
        component_by_node = {
            node_id: index
            for index, component in enumerate(components)
            for node_id in component
        }
        grouped: dict[int, list[str]] = {}
        for node_id in anchors:
            grouped.setdefault(component_by_node[node_id], []).append(node_id)

        result_graph = nx.Graph()
        for component_id, terminals in grouped.items():
            component_graph = self.graph.subgraph(components[component_id])
            partial = (
                component_graph.subgraph(terminals)
                if len(terminals) == 1
                else steiner_tree(
                    component_graph,
                    terminals,
                    weight="weight",
                    method="mehlhorn",
                )
            )
            result_graph = nx.compose(result_graph, partial)

        if result_graph.number_of_nodes() > max_nodes:
            raise RuntimeError(
                "minimum connected subgraph requires "
                f"{result_graph.number_of_nodes()} nodes, which exceeds the "
                f"configured limit of {max_nodes}; refusing to return a "
                "disconnected truncation"
            )

        node_items = []
        for node_id in sorted(result_graph.nodes):
            record = self.records_by_id[node_id]
            node_items.append(
                {
                    "id": record.id,
                    "name": record.name,
                    "label": record.label,
                    "comment": record.comment,
                    "entity_type": record.entity_type,
                }
            )
        directed_edges: dict[tuple[str, str], set[str]] = {}
        for _, _, data in result_graph.edges(data=True):
            for source, relation, target in data.get("statements", set()):
                directed_edges.setdefault((source, target), set()).add(relation)
        edge_items = [
            {
                "source": source,
                "source_label": self.records_by_id[source].label,
                "target": target,
                "target_label": self.records_by_id[target].label,
                "relations": sorted(relations),
            }
            for (source, target), relations in sorted(directed_edges.items())
        ]
        return GraphRetrievalResult(
            anchors=[
                {
                    "id": node_id,
                    "name": self.records_by_id[node_id].name,
                    "label": self.records_by_id[node_id].label,
                }
                for node_id in anchors
            ],
            nodes=node_items,
            edges=edge_items,
            disconnected=len(grouped) > 1,
        )

    def _build(self) -> None:
        entity_types: dict[str, str] = {}
        for rdf_type, label in ENTITY_TYPES.items():
            for subject in self.rdf_graph.subjects(RDF.type, rdf_type):
                if isinstance(subject, URIRef):
                    entity_types.setdefault(str(subject), label)

        for subject, predicate, obj in self.rdf_graph:
            if predicate in DIRECT_RELATIONS:
                if isinstance(subject, URIRef):
                    entity_types.setdefault(str(subject), "Entity")
                if isinstance(obj, URIRef):
                    entity_types.setdefault(str(obj), "Entity")

        for node_id, entity_type in sorted(entity_types.items()):
            subject = URIRef(node_id)
            label = preferred_literal(
                self.rdf_graph,
                subject,
                (RDFS.label, SKOS.prefLabel, SKOS.altLabel),
            )
            record = EntityRecord(
                id=node_id,
                name=local_name(node_id),
                label=label or local_name(node_id),
                comment=preferred_literal(self.rdf_graph, subject, (RDFS.comment,)) or "",
                entity_type=entity_type,
            )
            self.records_by_id[node_id] = record
            self.graph.add_node(node_id)

        for subject, predicate, obj in self.rdf_graph:
            if (
                predicate in DIRECT_RELATIONS
                and isinstance(subject, URIRef)
                and isinstance(obj, URIRef)
                and str(subject) in self.records_by_id
                and str(obj) in self.records_by_id
            ):
                self._add_edge(str(subject), str(obj), local_name(str(predicate)))

        for relation in self.rdf_graph.subjects(RDF.type, OWL.ObjectProperty):
            if not isinstance(relation, URIRef):
                continue
            domains = [
                str(value)
                for value in self.rdf_graph.objects(relation, RDFS.domain)
                if isinstance(value, URIRef) and str(value) in self.records_by_id
            ]
            ranges = [
                str(value)
                for value in self.rdf_graph.objects(relation, RDFS.range)
                if isinstance(value, URIRef) and str(value) in self.records_by_id
            ]
            for domain in domains:
                for range_id in ranges:
                    self._add_edge(domain, range_id, local_name(str(relation)))

    def _add_edge(self, source: str, target: str, relation: str) -> None:
        statement = (source, relation, target)
        if self.graph.has_edge(source, target):
            self.graph[source][target].setdefault("statements", set()).add(statement)
        else:
            self.graph.add_edge(source, target, statements={statement}, weight=1)

def build_index(
    ontology_path: Path,
    runtime_state_dir: Path,
    config: EmbeddingConfig | None = None,
) -> IndexMetadata:
    config = config or EmbeddingConfig.from_environment()
    vector_top_k = positive_environment_integer(
        "ONTOLOGY_VECTOR_TOP_K",
        DEFAULT_TOP_K,
        MAX_TOP_K,
    )
    graph_algorithm = os.environ.get(
        "ONTOLOGY_GRAPH_ALGORITHM",
        GRAPH_ALGORITHM,
    ).strip()
    if graph_algorithm != GRAPH_ALGORITHM:
        raise RuntimeError("ONTOLOGY_GRAPH_ALGORITHM is unsupported")
    ontology_path = ontology_path.resolve()
    runtime_state_dir = runtime_state_dir.resolve()
    ontology = OntologyGraph.from_file(ontology_path)
    records = ontology.entity_records()
    if not records:
        raise RuntimeError("ontology contains no indexable classes or properties")

    embedder = build_embedder(config)
    vectors = embedder.encode([record.embedding_text for record in records])
    if vectors.ndim != 2 or vectors.shape[0] != len(records):
        raise RuntimeError("embedding output does not match ontology entity count")

    index_dir = runtime_state_dir / INDEX_DIRECTORY
    database_dir = index_dir / LANCEDB_DIRECTORY
    database_dir.mkdir(parents=True, exist_ok=True)
    dimension = int(vectors.shape[1])
    data = pa.table(
        {
            "id": pa.array([record.id for record in records], type=pa.string()),
            "name": pa.array([record.name for record in records], type=pa.string()),
            "label": pa.array([record.label for record in records], type=pa.string()),
            "comment": pa.array([record.comment for record in records], type=pa.string()),
            "entity_type": pa.array(
                [record.entity_type for record in records],
                type=pa.string(),
            ),
            "text": pa.array(
                [record.embedding_text for record in records],
                type=pa.string(),
            ),
            "vector": pa.array(
                vectors.tolist(),
                type=pa.list_(pa.float32(), dimension),
            ),
        }
    )
    lancedb.connect(database_dir).create_table(
        LANCEDB_TABLE,
        data=data,
        mode="overwrite",
    )

    metadata = IndexMetadata(
        schema_version=INDEX_SCHEMA_VERSION,
        ontology_sha256=sha256_file(ontology_path),
        ontology_file=ontology_path.name,
        entity_count=len(records),
        vector_dimension=dimension,
        embedding_backend=config.backend,
        embedding_model=config.model,
        embedding_max_length=config.max_length,
        embedding_normalize=config.normalize,
        vector_top_k=vector_top_k,
        graph_algorithm=graph_algorithm,
        graph_implementation=GRAPH_IMPLEMENTATION,
        graph_max_nodes=DEFAULT_GRAPH_MAX_NODES,
        lancedb_table=LANCEDB_TABLE,
    )
    write_json_atomic(index_dir / INDEX_METADATA_FILE, asdict(metadata))
    return metadata


def retrieve(
    ontology_path: Path,
    runtime_state_dir: Path,
    *,
    question: str,
    keywords: list[str],
    top_k: int | None = None,
) -> dict[str, object]:
    normalized_question = question.strip()
    normalized_keywords = [keyword.strip() for keyword in keywords if keyword.strip()]
    if not normalized_question:
        raise RuntimeError("question cannot be empty")
    if not normalized_keywords:
        raise RuntimeError("at least one ontology keyword is required")

    index_dir = runtime_state_dir.resolve() / INDEX_DIRECTORY
    metadata = IndexMetadata.load(index_dir / INDEX_METADATA_FILE)
    actual_digest = sha256_file(ontology_path)
    if actual_digest != metadata.ontology_sha256:
        raise RuntimeError("Runtime ontology differs from the indexed snapshot")
    expected_digest = os.environ.get("ONTOLOGY_EXPECTED_SHA256", "").strip().lower()
    if expected_digest and (
        not is_sha256(expected_digest) or expected_digest != actual_digest
    ):
        raise RuntimeError("Runtime ontology digest validation failed")

    effective_top_k = metadata.vector_top_k if top_k is None else top_k
    if not 1 <= effective_top_k <= MAX_TOP_K:
        raise RuntimeError(f"top-k must be between 1 and {MAX_TOP_K}")

    config = EmbeddingConfig(
        backend=metadata.embedding_backend,
        model=metadata.embedding_model,
        max_length=metadata.embedding_max_length,
        normalize=metadata.embedding_normalize,
    )
    query_vector = build_embedder(config).encode(["\n".join(normalized_keywords)])[0]
    if query_vector.size != metadata.vector_dimension:
        raise RuntimeError("query embedding dimension differs from the Runtime index")

    table = lancedb.connect(index_dir / LANCEDB_DIRECTORY).open_table(
        metadata.lancedb_table
    )
    rows = (
        table.search(np.asarray(query_vector, dtype=np.float32))
        .metric("cosine")
        .limit(effective_top_k)
        .select(["id", "name", "label", "comment", "entity_type", "text", "_distance"])
        .to_list()
    )
    hits = [
        {
            "id": row["id"],
            "name": row["name"],
            "label": row["label"],
            "comment": row["comment"],
            "entity_type": row["entity_type"],
            "text": row["text"],
            "distance": float(row["_distance"]),
        }
        for row in rows
    ]

    ontology = OntologyGraph.from_file(ontology_path)
    graph = ontology.retrieve_by_anchor_ids(
        [hit["id"] for hit in hits],
        max_nodes=metadata.graph_max_nodes,
    )
    return {
        "schema_version": 1,
        "question": normalized_question,
        "keywords": normalized_keywords,
        "hits": hits,
        "graph_algorithm": metadata.graph_algorithm,
        "graph_implementation": metadata.graph_implementation,
        "graph": graph.as_dict(),
        "index": {
            "embedding_backend": metadata.embedding_backend,
            "vector_top_k": effective_top_k,
            "ontology_sha256": metadata.ontology_sha256,
        },
    }


def build_embedder(config: EmbeddingConfig) -> Embedder:
    if config.backend == "deterministic":
        return DeterministicEmbedder()
    return BgeM3Embedder(config)


def preferred_literal(
    graph: Graph,
    subject: URIRef,
    predicates: tuple[URIRef, ...],
) -> str | None:
    values = [
        value
        for predicate in predicates
        for value in graph.objects(subject, predicate)
        if isinstance(value, Literal)
    ]
    if not values:
        return None
    values.sort(
        key=lambda value: (
            0 if (value.language or "").lower().startswith("zh") else 1,
            str(value).casefold(),
        )
    )
    return str(values[0])


def local_name(iri: str) -> str:
    return unquote(iri.rsplit("#", 1)[-1].rsplit("/", 1)[-1])


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def is_sha256(value: str) -> bool:
    return len(value) == 64 and all(character in "0123456789abcdef" for character in value)


def positive_environment_integer(name: str, default: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer") from error
    if not 1 <= value <= maximum:
        raise RuntimeError(f"{name} must be between 1 and {maximum}")
    return value


def boolean_environment_value(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be a boolean value")


def write_json_atomic(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)
