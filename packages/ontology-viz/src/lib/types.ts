/**
 * @ontology/viz — Generic ontology visualization types
 *
 * These types are intentionally domain-neutral. They model OWL/RDF
 * ontology concepts — classes, object properties, reference points,
 * and provenance annotations — without any 3GPP-specific knowledge.
 *
 * Spec: OWL 2 Web Ontology Language (W3C Recommendation)
 *       RDF Schema 1.1 (W3C Recommendation)
 */

// ─── Provenance ───────────────────────────────────────────────

/** Provenance level of an ontology entity. */
export type ProvenanceLevel = "L1" | "L2" | "L3";

/**
 * Provenance record for a single ontology entity.
 *
 * L1 — Direct spec reference: specRef + specClause point to a
 *      single 3GPP (or other standard) clause.
 * L2 — Ontologist inference/abstraction: designRationale explains
 *      the reasoning; derivedFrom lists supporting spec clauses.
 * L3 — Non-normative operational extension: scopeNote marks the
 *      entity as outside spec scope; designRationale justifies
 *      the operational necessity.
 */
export interface Provenance {
  level: ProvenanceLevel;
  specRef?: string;          // L1: e.g. "TS 23.501"
  specClause?: string;       // L1: e.g. "clause 6.2.3"
  designRationale?: string;  // L2/L3: design reasoning (localised)
  derivedFrom?: string[];    // L2: supporting spec clauses / entities
  scopeNote?: string;        // L3: non-normative marker
  source?: string;           // dcterms:source (alternative to specRef)
}

// ─── Ontology entities ─────────────────────────────────────────

export interface OntologyEntity {
  /** Discriminant: "class" | "objectProperty" | "individual" */
  kind: "class" | "objectProperty" | "individual";
  /** Full IRI (e.g. http://3gpp-ontology.org/ns/5gs#UPF) */
  iri: string;
  /** Compact name (e.g. "UPF") */
  localName: string;
  /** rdfs:label in the primary language */
  label: string;
  /** rdfs:label in Chinese, if available */
  labelZh?: string;
  /** Common abbreviation (e.g. "UPF", "AMF") */
  abbreviation?: string;
  /** rdfs:comment — human-readable description */
  comment?: string;
  /** Provenance annotations */
  provenance: Provenance;
}

/** An owl:Class (or rdfs:Class) */
export interface OntologyClass extends OntologyEntity {
  kind: "class";
  /** Parent classes (rdfs:subClassOf targets) */
  parentIRIs: string[];
  /** Domain membership IRI, if declared via belongsToDomain */
  domainIRI?: string;
  /** 3GPP generation tag ("4G" | "5G"), if applicable */
  generation?: string;
}

/** An owl:ObjectProperty */
export interface OntologyObjectProperty extends OntologyEntity {
  kind: "objectProperty";
  /** rdfs:domain target IRI (if any) */
  domainIRI?: string;
  /** rdfs:range target IRI (if any) */
  rangeIRI?: string;
  /** Super-properties (rdfs:subPropertyOf targets) */
  parentIRIs: string[];
  /** Whether this is a symmetric property */
  symmetric: boolean;
  /** Whether this is a transitive property */
  transitive: boolean;
  /** Direction classification: user-plane, control-plane, or generic */
  direction?: "userPlane" | "controlPlane" | "generic";
}

/** A named individual (e.g. a ReferencePoint instance) */
export interface OntologyIndividual extends OntologyEntity {
  kind: "individual";
  /** Types (rdf:type targets) */
  typeIRIs: string[];
}

// ─── Graph data model ──────────────────────────────────────────

/**
 * Complete data for rendering an ontology graph.
 * This is the output of parser.ts and the input to OntologyGraph.
 */
export interface OntologyGraphData {
  ontologyIRI: string;
  ontologyTitle?: string;
  classes: OntologyClass[];
  objectProperties: OntologyObjectProperty[];
  individuals: OntologyIndividual[];
}

// ─── Graph node / edge (React Flow compatible) ──────────────────

/** Per-node rendering metadata carried in React Flow's Node.data */
export interface GraphNodeData extends Record<string, unknown> {
  entity: OntologyClass | OntologyIndividual;
  provenanceLevel: ProvenanceLevel;
  /** Domain-level colour key (e.g. "RadioAccess") */
  domainKey?: string;
  selected: boolean;
}

/** Per-edge rendering metadata carried in React Flow's Edge.data */
export interface GraphEdgeData extends Record<string, unknown> {
  property: OntologyObjectProperty;
  /** Whether this edge represents a subClassOf relationship */
  isSubClassOf: boolean;
  provenanceLevel: ProvenanceLevel;
}

/** Supported layout algorithms */
export type LayoutMode = "dagre" | "force";

// ─── Colour scheme (domain-configurable) ────────────────────────

export interface DomainColorScheme {
  /** Map from domain key to CSS colour */
  domainColors: Record<string, string>;
  /** Colours for each provenance level */
  provenanceColors: Record<ProvenanceLevel, string>;
  /** Default colour for nodes without a domain */
  defaultNodeColor: string;
  /** Default colour for edges */
  defaultEdgeColor: string;
}

// ─── Filter state ───────────────────────────────────────────────

export interface GraphFilters {
  /** Show only entities matching these domain keys (empty = all) */
  domains: string[];
  /** Show only entities matching these generations (empty = all) */
  generations: string[];
  /** Show only entities at these provenance levels (empty = all) */
  provenanceLevels: ProvenanceLevel[];
  /** Free-text search (matches label, localName, abbreviation, comment) */
  search: string;
}
