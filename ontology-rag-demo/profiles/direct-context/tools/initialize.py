from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from urllib.parse import unquote

from rdflib import OWL, RDF, RDFS, SKOS, Graph, Literal, URIRef

CONTEXT_MARKER = "{{ONTOLOGY_CONTEXT}}"
ENTITY_TYPES = (
    OWL.Class,
    RDFS.Class,
    OWL.ObjectProperty,
    OWL.DatatypeProperty,
    OWL.AnnotationProperty,
    RDF.Property,
)


def main() -> int:
    runtime_root = required_directory("ONTOLOGY_RUNTIME_ROOT")
    profile_dir = required_directory("ONTOLOGY_PROFILE_DIR")
    dataset_dir = required_directory("ONTOLOGY_DATASET_DIR")
    generated_dir = required_directory("ONTOLOGY_GENERATED_DIR")
    ontology_path = required_file("ONTOLOGY_PATH")
    assert_within(profile_dir, Path(__file__).resolve(), "initializer script")
    assert_within(dataset_dir, ontology_path, "ontology snapshot")
    assert_within(runtime_root, profile_dir, "Profile snapshot")
    assert_within(runtime_root, dataset_dir, "Dataset snapshot")
    assert_within(runtime_root, generated_dir, "generated directory")

    graph = Graph()
    graph.parse(ontology_path)
    context, entity_count = render_ontology_context(graph, ontology_path)

    template_path = profile_dir / "opencode" / "prompt.template.md"
    prompt_path = profile_dir / "opencode" / "prompt.md"
    assert_within(profile_dir, template_path, "prompt template")
    assert_within(profile_dir, prompt_path, "generated prompt")
    template = template_path.read_text(encoding="utf-8")
    if template.count(CONTEXT_MARKER) != 1:
        raise RuntimeError("prompt template must contain exactly one ontology context marker")

    generated_dir.mkdir(parents=True, exist_ok=True)
    context_path = generated_dir / "ontology-context.yaml"
    write_text_atomic(context_path, f"{context}\n")
    write_text_atomic(prompt_path, template.replace(CONTEXT_MARKER, context))

    summary = {
        "schema_version": 1,
        "profile": "direct-context",
        "ontology_sha256": sha256_file(ontology_path),
        "entity_count": entity_count,
        "generated": ["ontology-context.yaml"],
    }
    write_text_atomic(
        generated_dir / "initializer-result.json",
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def render_ontology_context(graph: Graph, ontology_path: Path) -> tuple[str, int]:
    classes = sorted(
        {
            subject
            for class_type in (OWL.Class, RDFS.Class)
            for subject in graph.subjects(RDF.type, class_type)
            if isinstance(subject, URIRef)
        },
        key=str,
    )
    properties = sorted(
        {
            subject
            for entity_type in (
                OWL.ObjectProperty,
                OWL.DatatypeProperty,
                OWL.AnnotationProperty,
                RDF.Property,
            )
            for subject in graph.subjects(RDF.type, entity_type)
            if isinstance(subject, URIRef)
        },
        key=str,
    )

    lines = [
        "ontology:",
        f"  source_file: {yaml_scalar(ontology_path.name)}",
        f"  source_sha256: {yaml_scalar(sha256_file(ontology_path))}",
        "  classes:",
    ]
    if not classes:
        lines.append("    []")
    for entity in classes:
        label = preferred_literal(graph, entity, (RDFS.label, SKOS.prefLabel))
        comment = preferred_literal(graph, entity, (RDFS.comment,))
        lines.extend(
            [
                f"    - name: {yaml_scalar(local_name(entity))}",
                f"      iri: {yaml_scalar(str(entity))}",
                f"      label: {yaml_nullable(label)}",
                f"      comment: {yaml_nullable(comment)}",
                "      sub_class_of:",
            ]
        )
        parents = sorted(
            {
                local_name(parent)
                for parent in graph.objects(entity, RDFS.subClassOf)
                if isinstance(parent, URIRef)
            }
        )
        lines.extend(
            [f"        - {yaml_scalar(parent)}" for parent in parents]
            if parents
            else ["        []"]
        )

    lines.append("  properties:")
    if not properties:
        lines.append("    []")
    for entity in properties:
        label = preferred_literal(graph, entity, (RDFS.label, SKOS.prefLabel))
        comment = preferred_literal(graph, entity, (RDFS.comment,))
        property_type = next(
            (
                local_name(entity_type)
                for entity_type in ENTITY_TYPES
                if (entity, RDF.type, entity_type) in graph
            ),
            "Property",
        )
        lines.extend(
            [
                f"    - name: {yaml_scalar(local_name(entity))}",
                f"      iri: {yaml_scalar(str(entity))}",
                f"      type: {yaml_scalar(property_type)}",
                f"      label: {yaml_nullable(label)}",
                f"      comment: {yaml_nullable(comment)}",
                f"      domain: {yaml_name_list(graph.objects(entity, RDFS.domain))}",
                f"      range: {yaml_name_list(graph.objects(entity, RDFS.range))}",
            ]
        )
    return "\n".join(lines), len(classes) + len(properties)


def preferred_literal(graph: Graph, subject: URIRef, predicates: tuple[URIRef, ...]) -> str | None:
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


def yaml_name_list(values: object) -> str:
    names = sorted(
        {local_name(value) for value in values if isinstance(value, URIRef)}
    )
    return "[" + ", ".join(yaml_scalar(name) for name in names) + "]"


def yaml_nullable(value: str | None) -> str:
    return "null" if value is None else yaml_scalar(value)


def yaml_scalar(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def local_name(value: URIRef) -> str:
    iri = str(value)
    return unquote(iri.rsplit("#", 1)[-1].rsplit("/", 1)[-1])


def required_directory(name: str) -> Path:
    value = required_path(name)
    if not value.is_dir():
        raise RuntimeError(f"{name} must point to an existing directory")
    return value


def required_file(name: str) -> Path:
    value = required_path(name)
    if not value.is_file():
        raise RuntimeError(f"{name} must point to an existing file")
    return value


def required_path(name: str) -> Path:
    raw = os.environ.get(name, "").strip()
    if not raw:
        raise RuntimeError(f"{name} is required")
    return Path(raw).resolve()


def assert_within(root: Path, candidate: Path, label: str) -> None:
    try:
        candidate.resolve().relative_to(root.resolve())
    except ValueError as error:
        raise RuntimeError(f"{label} escapes the Runtime profile snapshot") from error


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_text_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


if __name__ == "__main__":
    raise SystemExit(main())
