import { Parser } from "n3";

import type {
  OntologyEdge,
  OntologyEdgeKind,
  OntologyEntity,
  OntologyEntityKind,
  OntologyField,
  OntologyGraphData,
  OntologyParseOptions,
  OntologyValue,
} from "./types";

const NS = {
  RDF: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  RDFS: "http://www.w3.org/2000/01/rdf-schema#",
  OWL: "http://www.w3.org/2002/07/owl#",
  SKOS: "http://www.w3.org/2004/02/skos/core#",
  DC: "http://purl.org/dc/elements/1.1/",
  DCT: "http://purl.org/dc/terms/",
} as const;

const RDF_XML_NS = NS.RDF;
const RDF_ABOUT = "about";
const RDF_RESOURCE = "resource";
const RDF_ID = "ID";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

const ONTOLOGY_TYPE_IRIS: Record<OntologyEntityKind, string> = {
  Class: `${NS.OWL}Class`,
  ObjectProperty: `${NS.OWL}ObjectProperty`,
  DatatypeProperty: `${NS.OWL}DatatypeProperty`,
  AnnotationProperty: `${NS.OWL}AnnotationProperty`,
};

const ENTITY_KIND_BY_TYPE_IRI = new Map(
  Object.entries(ONTOLOGY_TYPE_IRIS).map(([kind, iri]) => [iri, kind as OntologyEntityKind]),
);

interface ParsedStatement {
  subject: string;
  predicate: string;
  object: OntologyValue;
}

function iri(ns: keyof typeof NS, local: string) {
  return NS[ns] + local;
}

function localName(value: string) {
  const hash = value.lastIndexOf("#");
  if (hash >= 0) return value.slice(hash + 1);
  const slash = value.lastIndexOf("/");
  return value.slice(slash + 1);
}

function namespaceOf(value: string) {
  const hash = value.lastIndexOf("#");
  if (hash >= 0) return value.slice(0, hash + 1);
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(0, slash + 1) : "";
}

function compactIRI(value: string) {
  const namespace = namespaceOf(value);
  const local = localName(value);
  if (namespace === NS.RDF) return `rdf:${local}`;
  if (namespace === NS.RDFS) return `rdfs:${local}`;
  if (namespace === NS.OWL) return `owl:${local}`;
  if (namespace === NS.SKOS) return `skos:${local}`;
  if (namespace === NS.DC) return `dc:${local}`;
  if (namespace === NS.DCT) return `dcterms:${local}`;
  return local;
}

function typedElementIRI(element: Element) {
  if (!element.namespaceURI || !element.localName) return undefined;
  if (element.namespaceURI === RDF_XML_NS && element.localName === "Description") return undefined;
  return element.namespaceURI + element.localName;
}

function subjectIRI(element: Element, baseIRI: string) {
  const about = element.getAttributeNS(RDF_XML_NS, RDF_ABOUT);
  if (about) return about;
  const id = element.getAttributeNS(RDF_XML_NS, RDF_ID);
  if (id) return `${baseIRI.replace(/[#/]$/, "")}#${id}`;
  return undefined;
}

function childElements(element: Element) {
  return Array.from(element.children);
}

function parseRdfXml(content: string, baseIRI: string): ParsedStatement[] {
  const doc = new DOMParser().parseFromString(content, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error(parserError.textContent?.trim() || "RDF/XML parse failed");
  }

  const root = doc.documentElement;
  const statements: ParsedStatement[] = [];
  const topLevel = root.namespaceURI === RDF_XML_NS && root.localName === "RDF"
    ? childElements(root)
    : [root];

  for (const element of topLevel) {
    const subject = subjectIRI(element, baseIRI);
    if (!subject) continue;

    const explicitType = typedElementIRI(element);
    if (explicitType) {
      statements.push({
        subject,
        predicate: iri("RDF", "type"),
        object: { value: explicitType, termType: "iri" },
      });
    }

    for (const child of childElements(element)) {
      if (!child.namespaceURI || !child.localName) continue;
      const predicate = child.namespaceURI + child.localName;
      const resource = child.getAttributeNS(RDF_XML_NS, RDF_RESOURCE) ?? child.getAttributeNS(RDF_XML_NS, RDF_ABOUT);
      if (resource) {
        statements.push({
          subject,
          predicate,
          object: { value: resource, termType: "iri" },
        });
        continue;
      }

      const value = child.textContent?.trim();
      if (!value) continue;
      const language = child.getAttributeNS(XML_NS, "lang") ?? undefined;
      statements.push({
        subject,
        predicate,
        object: { value, termType: "literal", language },
      });
    }
  }

  return statements;
}

function parseTurtle(content: string, baseIRI: string): ParsedStatement[] {
  const parser = new Parser({ format: "text/turtle", baseIRI });
  return parser.parse(content).flatMap<ParsedStatement>((quad) => {
    if (quad.subject.termType !== "NamedNode") return [];
    if (quad.object.termType === "NamedNode") {
      return [{
        subject: quad.subject.value,
        predicate: quad.predicate.value,
        object: { value: quad.object.value, termType: "iri" as const },
      }];
    }
    if (quad.object.termType === "Literal") {
      return [{
        subject: quad.subject.value,
        predicate: quad.predicate.value,
        object: {
          value: quad.object.value,
          termType: "literal" as const,
          language: quad.object.language || undefined,
        },
      }];
    }
    return [];
  });
}

function contentTypeFor(content: string, options: OntologyParseOptions) {
  if (options.contentType) return options.contentType;
  return content.trimStart().startsWith("<") ? "application/rdf+xml" : "text/turtle";
}

function valuesByPredicate(statements: ParsedStatement[], subject: string, termType?: OntologyValue["termType"]) {
  const grouped: Record<string, OntologyValue[]> = {};
  for (const statement of statements) {
    if (statement.subject !== subject) continue;
    if (termType && statement.object.termType !== termType) continue;
    if (!grouped[statement.predicate]) grouped[statement.predicate] = [];
    grouped[statement.predicate].push(statement.object);
  }
  return grouped;
}

function firstLiteral(entity: OntologyEntity, predicates: string[]) {
  for (const predicate of predicates) {
    const value = entity.literalProperties[predicate]?.[0]?.value;
    if (value) return value;
  }
  return undefined;
}

export function getOntologyFieldValues(entity: OntologyEntity, fieldId: string): string[] {
  if (fieldId === "iri") return [entity.iri];
  if (fieldId === "localName") return [entity.localName];
  if (fieldId === "namespace") return entity.namespace ? [entity.namespace] : [];
  if (fieldId === "rdf:type") return [entity.kind];
  return entity.literalProperties[fieldId]?.map((item) => item.value).filter(Boolean) ?? [];
}

export function getOntologyDisplayValue(entity: OntologyEntity, fieldId: string) {
  return getOntologyFieldValues(entity, fieldId)[0] ?? "";
}

export function getOntologyDefaultLabel(entity: OntologyEntity) {
  return (
    firstLiteral(entity, [
      iri("RDFS", "label"),
      iri("SKOS", "prefLabel"),
      iri("DC", "title"),
      iri("DCT", "title"),
    ]) ?? entity.localName
  );
}

export function getOntologyDefaultDescription(entity: OntologyEntity) {
  return firstLiteral(entity, [
    iri("RDFS", "comment"),
    iri("SKOS", "definition"),
    iri("DC", "description"),
    iri("DCT", "description"),
    `${entity.namespace}definition`,
  ]);
}

function edgeKindLabel(kind: OntologyEdgeKind) {
  const labels: Record<OntologyEdgeKind, string> = {
    subClassOf: "subClassOf",
    objectRelation: "objectProperty",
    domain: "domain",
    range: "range",
    subPropertyOf: "subPropertyOf",
  };
  return labels[kind];
}

function makeEdge(
  kind: OntologyEdgeKind,
  source: string,
  target: string,
  label: string,
  propertyIRI?: string,
): OntologyEdge {
  return {
    id: `${kind}:${source}->${target}:${propertyIRI ?? label}`,
    kind,
    source,
    target,
    label,
    propertyIRI,
  };
}

function buildFields(entities: OntologyEntity[]) {
  const fieldMap = new Map<string, OntologyField>();

  const addField = (field: OntologyField) => {
    const existing = fieldMap.get(field.id);
    if (!existing) {
      fieldMap.set(field.id, field);
      return;
    }
    existing.occurrences += field.occurrences;
    for (const kind of field.entityKinds) {
      if (!existing.entityKinds.includes(kind)) existing.entityKinds.push(kind);
    }
  };

  for (const field of [
    { id: "localName", label: "localName" },
    { id: "iri", label: "IRI" },
    { id: "rdf:type", label: "rdf:type" },
    { id: "namespace", label: "namespace" },
  ]) {
    addField({
      ...field,
      kind: "builtin",
      entityKinds: ["Class", "ObjectProperty", "DatatypeProperty", "AnnotationProperty"],
      occurrences: entities.length,
    });
  }

  for (const entity of entities) {
    for (const [predicate, values] of Object.entries(entity.literalProperties)) {
      addField({
        id: predicate,
        iri: predicate,
        kind: "literal",
        label: compactIRI(predicate),
        entityKinds: [entity.kind],
        occurrences: values.length,
      });
    }
  }

  return [...fieldMap.values()].sort((a, b) =>
    (a.kind === "builtin" ? 0 : 1) - (b.kind === "builtin" ? 0 : 1) ||
    b.occurrences - a.occurrences ||
    a.label.localeCompare(b.label),
  );
}

function buildEdges(entities: OntologyEntity[]) {
  const byIRI = new Map(entities.map((entity) => [entity.iri, entity]));
  const explicitClassIRIs = new Set(entities.filter((entity) => entity.kind === "Class").map((entity) => entity.iri));
  const edges: OntologyEdge[] = [];
  const seen = new Set<string>();
  const push = (edge: OntologyEdge) => {
    if (seen.has(edge.id)) return;
    seen.add(edge.id);
    edges.push(edge);
  };

  for (const entity of entities) {
    for (const target of entity.iriProperties[iri("RDFS", "subClassOf")] ?? []) {
      if (entity.kind === "Class" && explicitClassIRIs.has(target.value)) {
        push(makeEdge("subClassOf", entity.iri, target.value, edgeKindLabel("subClassOf")));
      }
    }

    for (const target of entity.iriProperties[iri("RDFS", "subPropertyOf")] ?? []) {
      if (byIRI.has(target.value)) {
        push(makeEdge("subPropertyOf", entity.iri, target.value, edgeKindLabel("subPropertyOf")));
      }
    }

    if (entity.kind !== "ObjectProperty" && entity.kind !== "DatatypeProperty") continue;

    const domains = entity.iriProperties[iri("RDFS", "domain")] ?? [];
    const ranges = entity.iriProperties[iri("RDFS", "range")] ?? [];

    if (entity.kind === "ObjectProperty") {
      for (const domain of domains) {
        for (const range of ranges) {
          if (explicitClassIRIs.has(domain.value) && explicitClassIRIs.has(range.value)) {
            push(makeEdge("objectRelation", domain.value, range.value, entity.localName, entity.iri));
          }
        }
      }
    }

    for (const domain of domains) {
      if (byIRI.has(domain.value)) {
        push(makeEdge("domain", entity.iri, domain.value, edgeKindLabel("domain"), entity.iri));
      }
    }
    for (const range of ranges) {
      if (byIRI.has(range.value)) {
        push(makeEdge("range", entity.iri, range.value, edgeKindLabel("range"), entity.iri));
      }
    }
  }

  return edges;
}

export function parseOntology(
  content: string,
  options: OntologyParseOptions = {},
): OntologyGraphData {
  const baseIRI = options.baseIRI ?? "urn:ontology";
  const statements = contentTypeFor(content, options) === "application/rdf+xml"
    ? parseRdfXml(content, baseIRI)
    : parseTurtle(content, baseIRI);

  const typeStatements = statements.filter(
    (statement) => statement.predicate === iri("RDF", "type") && statement.object.termType === "iri",
  );
  const entityTypes = new Map<string, OntologyEntityKind>();
  for (const statement of typeStatements) {
    const kind = ENTITY_KIND_BY_TYPE_IRI.get(statement.object.value);
    if (kind && !entityTypes.has(statement.subject)) {
      entityTypes.set(statement.subject, kind);
    }
  }

  const entities: OntologyEntity[] = [...entityTypes.entries()]
    .filter(([subject]) => !subject.includes("www.w3.org/2002/07/owl#"))
    .map(([subject, kind]) => ({
      id: subject,
      iri: subject,
      localName: localName(subject),
      namespace: namespaceOf(subject),
      kind,
      typeIRI: ONTOLOGY_TYPE_IRIS[kind],
      literalProperties: valuesByPredicate(statements, subject, "literal"),
      iriProperties: valuesByPredicate(statements, subject, "iri"),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.localName.localeCompare(b.localName));

  const ontology = statements.find(
    (statement) =>
      statement.predicate === iri("RDF", "type") &&
      statement.object.termType === "iri" &&
      statement.object.value === iri("OWL", "Ontology"),
  );
  const ontologyIRI = ontology?.subject ?? baseIRI;
  const title = ontology
    ? valuesByPredicate(statements, ontology.subject, "literal")[iri("DCT", "title")]?.[0]?.value ??
      valuesByPredicate(statements, ontology.subject, "literal")[iri("DC", "title")]?.[0]?.value
    : undefined;

  const stats: Record<OntologyEntityKind, number> = {
    Class: 0,
    ObjectProperty: 0,
    DatatypeProperty: 0,
    AnnotationProperty: 0,
  };
  for (const entity of entities) stats[entity.kind] += 1;

  return {
    ontologyIRI,
    ontologyTitle: title ?? options.ontologyTitleFallback ?? localName(ontologyIRI) ?? "Ontology",
    entities,
    edges: buildEdges(entities),
    fields: buildFields(entities),
    stats,
  };
}
