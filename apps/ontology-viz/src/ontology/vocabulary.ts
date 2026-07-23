import type { OntologyEdgeKind, PropertyKind, ResourceKind } from "./types";

export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const OWL = "http://www.w3.org/2002/07/owl#";
export const SKOS = "http://www.w3.org/2004/02/skos/core#";
export const DCTERMS = "http://purl.org/dc/terms/";
export const XSD = "http://www.w3.org/2001/XMLSchema#";

export const RDF_TYPE = `${RDF}type`;
export const RDFS_LABEL = `${RDFS}label`;
export const RDFS_COMMENT = `${RDFS}comment`;

export const RESOURCE_KIND_PRIORITY: ResourceKind[] = [
  "Ontology",
  "Class",
  "ObjectProperty",
  "DatatypeProperty",
  "AnnotationProperty",
  "NamedIndividual",
  "Datatype",
  "Restriction",
  "External",
];

export const RESOURCE_KIND_BY_TYPE = new Map<string, ResourceKind>([
  [`${OWL}Ontology`, "Ontology"],
  [`${OWL}Class`, "Class"],
  [`${OWL}DeprecatedClass`, "Class"],
  [`${RDFS}Class`, "Class"],
  [`${OWL}ObjectProperty`, "ObjectProperty"],
  [`${OWL}DatatypeProperty`, "DatatypeProperty"],
  [`${OWL}AnnotationProperty`, "AnnotationProperty"],
  [`${OWL}NamedIndividual`, "NamedIndividual"],
  [`${RDFS}Datatype`, "Datatype"],
  [`${OWL}Restriction`, "Restriction"],
]);

export const PROPERTY_TRAIT_BY_TYPE = new Map<string, string>([
  [`${OWL}FunctionalProperty`, "Functional"],
  [`${OWL}InverseFunctionalProperty`, "Inverse functional"],
  [`${OWL}TransitiveProperty`, "Transitive"],
  [`${OWL}SymmetricProperty`, "Symmetric"],
  [`${OWL}AsymmetricProperty`, "Asymmetric"],
  [`${OWL}ReflexiveProperty`, "Reflexive"],
  [`${OWL}IrreflexiveProperty`, "Irreflexive"],
  [`${OWL}DeprecatedClass`, "Deprecated"],
  [`${OWL}DeprecatedProperty`, "Deprecated"],
]);

export const PROPERTY_KINDS = new Set<ResourceKind>([
  "ObjectProperty",
  "DatatypeProperty",
  "AnnotationProperty",
]);

export const PROPERTY_KIND_ORDER: PropertyKind[] = [
  "ObjectProperty",
  "DatatypeProperty",
  "AnnotationProperty",
];

export const GRAPH_KINDS = new Set<ResourceKind>(["Class", "NamedIndividual"]);

export const META_TYPES = new Set<string>([
  ...RESOURCE_KIND_BY_TYPE.keys(),
  ...PROPERTY_TRAIT_BY_TYPE.keys(),
]);

export const LABEL_PREDICATES = new Set<string>([
  RDFS_LABEL,
  `${SKOS}prefLabel`,
  `${SKOS}altLabel`,
  `${DCTERMS}title`,
]);

export const DESCRIPTION_PREDICATES = new Set<string>([
  RDFS_COMMENT,
  `${SKOS}definition`,
  `${DCTERMS}description`,
]);

export interface EdgeDefinition {
  kind: OntologyEdgeKind;
  label: string;
  description: string;
  color: string;
}

export const EDGE_DEFINITION_BY_PREDICATE = new Map<string, EdgeDefinition>([
  [
    `${RDFS}subClassOf`,
    {
      kind: "subClassOf",
      label: "subClassOf",
      description: "子类关系：源类的实例同时也是目标类的实例。",
      color: "#708091",
    },
  ],
  [
    `${OWL}equivalentClass`,
    {
      kind: "equivalentClass",
      label: "equivalentClass",
      description: "等价类公理。",
      color: "#7c8298",
    },
  ],
  [
    `${OWL}disjointWith`,
    {
      kind: "disjointWith",
      label: "disjointWith",
      description: "不相交类公理。",
      color: "#9a7479",
    },
  ],
  [
    `${OWL}sameAs`,
    {
      kind: "sameAs",
      label: "sameAs",
      description: "两个标识指向同一个个体。",
      color: "#6f9184",
    },
  ],
  [
    `${OWL}differentFrom`,
    {
      kind: "differentFrom",
      label: "differentFrom",
      description: "两个标识指向不同个体。",
      color: "#9a7479",
    },
  ],
  [
    `${OWL}complementOf`,
    {
      kind: "classExpression",
      label: "complementOf",
      description: "类补集表达式。",
      color: "#868292",
    },
  ],
]);

export const RESTRICTION_OPERATOR_BY_PREDICATE = new Map<string, string>([
  [`${OWL}someValuesFrom`, "someValuesFrom"],
  [`${OWL}allValuesFrom`, "allValuesFrom"],
  [`${OWL}hasValue`, "hasValue"],
  [`${OWL}cardinality`, "cardinality"],
  [`${OWL}minCardinality`, "minCardinality"],
  [`${OWL}maxCardinality`, "maxCardinality"],
  [`${OWL}qualifiedCardinality`, "qualifiedCardinality"],
  [`${OWL}minQualifiedCardinality`, "minQualifiedCardinality"],
  [`${OWL}maxQualifiedCardinality`, "maxQualifiedCardinality"],
  [`${OWL}onClass`, "onClass"],
  [`${OWL}onDataRange`, "onDataRange"],
]);

export const RESTRICTION_OWNER_PREDICATES = new Set<string>([
  `${RDFS}subClassOf`,
  `${OWL}equivalentClass`,
]);
