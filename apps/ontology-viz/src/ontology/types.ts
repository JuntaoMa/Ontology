export type ResourceKind =
  | "Ontology"
  | "Class"
  | "ObjectProperty"
  | "DatatypeProperty"
  | "AnnotationProperty"
  | "NamedIndividual"
  | "Datatype"
  | "Restriction"
  | "External";

export type PropertyKind =
  | "ObjectProperty"
  | "DatatypeProperty"
  | "AnnotationProperty";

export interface OntologySource {
  key: string;
  name: string;
  path: string;
  format: OntologyFormat;
}

export type OntologyFormat =
  | "text/turtle"
  | "N-Triples"
  | "N-Quads"
  | "TriG"
  | "application/rdf+xml";

export interface LocalizedValue {
  predicate: string;
  value: string;
  language: string;
  datatype?: string;
}

export interface LiteralValue {
  kind: "literal";
  value: string;
  language: string;
  datatype?: string;
}

export interface ResourceValue {
  kind: "resource";
  id: string;
}

export type OntologyValue = LiteralValue | ResourceValue;

export interface RestrictionCondition {
  operator: string;
  value: OntologyValue;
}

export interface OntologyRestriction {
  id: string;
  propertyId?: string;
  conditions: RestrictionCondition[];
}

export interface PropertyAssociation {
  propertyId: string;
  values: OntologyValue[];
  restrictions: OntologyRestriction[];
}

export interface OntologyResource {
  id: string;
  iri: string;
  compactIri: string;
  localName: string;
  kind: ResourceKind;
  label: string;
  labels: LocalizedValue[];
  description: string;
  descriptionEntry?: LocalizedValue;
  traits: string[];
  annotations: LocalizedValue[];
  domains: string[];
  ranges: string[];
  properties: PropertyAssociation[];
  graphDegree: number;
}

export type OntologyEdgeKind =
  | "subClassOf"
  | "equivalentClass"
  | "disjointWith"
  | "sameAs"
  | "differentFrom"
  | "classExpression"
  | "instanceOf"
  | "objectRelation";

export interface OntologyGraphEdge {
  id: string;
  source: string;
  target: string;
  predicate: string;
  predicateIri: string;
  label: string;
  kind: OntologyEdgeKind;
  description: string;
  color: string;
}

export interface OntologyGraphProjection {
  nodeIds: string[];
  edges: OntologyGraphEdge[];
}

export interface OntologyIndexes {
  resourceById: Map<string, OntologyResource>;
  edgeById: Map<string, OntologyGraphEdge>;
  outgoingById: Map<string, OntologyGraphEdge[]>;
  incomingById: Map<string, OntologyGraphEdge[]>;
  adjacentIdsById: Map<string, Set<string>>;
}

export interface OntologyDocument {
  source: OntologySource;
  ontologyIri?: string;
  displayName: string;
  prefixes: Map<string, string>;
  resources: OntologyResource[];
  graph: OntologyGraphProjection;
  indexes: OntologyIndexes;
}

export interface ParseOntologyInput {
  text: string;
  name: string;
  path?: string;
  key?: string;
  format?: OntologyFormat;
}
