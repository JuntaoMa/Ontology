export type OntologyEntityKind =
  | "Class"
  | "ObjectProperty"
  | "DatatypeProperty"
  | "AnnotationProperty";

export type OntologyEdgeKind =
  | "subClassOf"
  | "objectRelation"
  | "domain"
  | "range"
  | "subPropertyOf";

export type OntologyFieldKind = "builtin" | "literal";

export interface OntologyValue {
  value: string;
  termType: "literal" | "iri";
  language?: string;
}

export interface OntologyField {
  id: string;
  iri?: string;
  kind: OntologyFieldKind;
  label: string;
  entityKinds: OntologyEntityKind[];
  occurrences: number;
}

export interface OntologyEntity {
  id: string;
  iri: string;
  localName: string;
  namespace: string;
  kind: OntologyEntityKind;
  typeIRI: string;
  literalProperties: Record<string, OntologyValue[]>;
  iriProperties: Record<string, OntologyValue[]>;
}

export interface OntologyEdge {
  id: string;
  kind: OntologyEdgeKind;
  source: string;
  target: string;
  label: string;
  propertyIRI?: string;
}

export interface OntologyGraphData {
  ontologyIRI: string;
  ontologyTitle?: string;
  entities: OntologyEntity[];
  edges: OntologyEdge[];
  fields: OntologyField[];
  stats: Record<OntologyEntityKind, number>;
}

export interface OntologyParseOptions {
  baseIRI?: string;
  contentType?: "application/rdf+xml" | "text/turtle";
  ontologyTitleFallback?: string;
}

export interface OntologyLayoutPosition {
  x: number;
  y: number;
  z?: number;
}

export interface OntologyLayoutSnapshot {
  nodes: Record<string, OntologyLayoutPosition>;
  updatedAt?: number;
}
