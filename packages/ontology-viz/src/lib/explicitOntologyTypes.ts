export type ExplicitOntologyEntityKind =
  | "Class"
  | "ObjectProperty"
  | "DatatypeProperty"
  | "AnnotationProperty";

export type ExplicitOntologyEdgeKind =
  | "subClassOf"
  | "objectRelation"
  | "domain"
  | "range"
  | "subPropertyOf";

export type ExplicitOntologyLayoutMode = "layered" | "force";

export type ExplicitOntologyColorMode = "type" | "field";

export type ExplicitOntologyFieldKind = "builtin" | "literal";

export interface ExplicitOntologyValue {
  value: string;
  termType: "literal" | "iri";
  language?: string;
}

export interface ExplicitOntologyField {
  id: string;
  iri?: string;
  kind: ExplicitOntologyFieldKind;
  label: string;
  entityKinds: ExplicitOntologyEntityKind[];
  occurrences: number;
}

export interface ExplicitOntologyEntity {
  id: string;
  iri: string;
  localName: string;
  namespace: string;
  kind: ExplicitOntologyEntityKind;
  typeIRI: string;
  literalProperties: Record<string, ExplicitOntologyValue[]>;
  iriProperties: Record<string, ExplicitOntologyValue[]>;
}

export interface ExplicitOntologyEdge {
  id: string;
  kind: ExplicitOntologyEdgeKind;
  source: string;
  target: string;
  label: string;
  propertyIRI?: string;
}

export interface ExplicitOntologyGraphData {
  ontologyIRI: string;
  ontologyTitle?: string;
  entities: ExplicitOntologyEntity[];
  edges: ExplicitOntologyEdge[];
  fields: ExplicitOntologyField[];
  stats: Record<ExplicitOntologyEntityKind, number>;
}

export interface ExplicitOntologyCardConfig {
  titleField: string;
  subtitleField: string;
  descriptionField: string;
  badgeFields: string[];
}

export interface ExplicitOntologyEdgeConfig {
  showLabels: boolean;
  showArrows: boolean;
  colorByKind: Record<ExplicitOntologyEdgeKind, string>;
}

export interface ExplicitOntologyVisualConfig {
  visibleEntityKinds: ExplicitOntologyEntityKind[];
  layoutMode: ExplicitOntologyLayoutMode;
  card: ExplicitOntologyCardConfig;
  color: {
    mode: ExplicitOntologyColorMode;
    field?: string;
    typeColors: Record<ExplicitOntologyEntityKind, string>;
  };
  edges: ExplicitOntologyEdgeConfig;
}

export interface ExplicitOntologyParseOptions {
  baseIRI?: string;
  contentType?: "application/rdf+xml" | "text/turtle";
  ontologyTitleFallback?: string;
}
