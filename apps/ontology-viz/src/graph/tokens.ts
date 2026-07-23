import type { OntologyEdgeKind, ResourceKind } from "../ontology";

export const RESOURCE_COLORS: Record<ResourceKind, string> = {
  Ontology: "#657d8c",
  Class: "#e38c7a",
  ObjectProperty: "#887f9f",
  DatatypeProperty: "#8a9274",
  AnnotationProperty: "#9a7f87",
  NamedIndividual: "#99a4bc",
  Datatype: "#739398",
  Restriction: "#868292",
  External: "#9299a3",
};

export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  Ontology: "Ontology",
  Class: "Class",
  ObjectProperty: "Object Property",
  DatatypeProperty: "Datatype Property",
  AnnotationProperty: "Annotation Property",
  NamedIndividual: "Named Individual",
  Datatype: "Datatype",
  Restriction: "Restriction",
  External: "External",
};

export const EDGE_LABELS: Record<OntologyEdgeKind, string> = {
  subClassOf: "subClassOf",
  equivalentClass: "equivalentClass",
  disjointWith: "disjointWith",
  sameAs: "sameAs",
  differentFrom: "differentFrom",
  classExpression: "Class expression",
  instanceOf: "type",
  objectRelation: "Object relation",
};

export const PERFORMANCE_LIMITS = {
  arrows: 1_500,
  dimUnrelated: 2_000,
  minimapDelay: 240,
} as const;
