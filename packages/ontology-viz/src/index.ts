/**
 * @ontology/viz — Ontology visualization component library
 *
 * Generic, domain-neutral React components for visualizing
 * OWL/RDF ontology graphs with provenance evidence.
 *
 * ## Quick start
 *
 * ```ts
 * import { parseTTLFiles, OntologyGraph, ProvenancePanel, FilterBar } from "@ontology/viz";
 * import "@ontology/viz/styles";
 *
 * const data = parseTTLFiles([ttlContent1, ttlContent2]);
 * // Then render <OntologyGraph data={data} ... />
 * ```
 */

// Types — re-export for consumers
export type {
  OntologyEntity,
  OntologyClass,
  OntologyObjectProperty,
  OntologyIndividual,
  OntologyGraphData,
  OntologyVocabulary,
  OntologyParseOptions,
  GraphNodeData,
  GraphEdgeData,
  Provenance,
  ProvenanceLevel,
  DomainColorScheme,
  GraphFilters,
  LayoutMode,
  FilterBarLabels,
  ProvenancePanelLabels,
} from "./lib/types";
export type {
  BilingualLabel,
  MappingGraphClassMapping,
  MappingGraphData,
  MappingGraphEdge,
  MappingGraphEdgeKind,
  MappingGraphEdgeMapping,
  MappingGraphLayoutMode,
  MappingGraphNode,
  MappingGraphNodeKind,
  MappingGraphObjectNode,
  MappingGraphProperty,
  MappingGraphRelationNode,
  MappingGraphSourceTableNode,
} from "./lib/mappingGraphTypes";

// Parser
export { parseTTLFiles } from "./lib/parser";

// Colour utilities
export {
  DEFAULT_COLOR_SCHEME,
  DEFAULT_DOMAIN_COLORS,
  DEFAULT_PROVENANCE_COLORS,
  domainKeyFromIRI,
} from "./lib/colors";

// Components
export { OntologyGraph } from "./components/OntologyGraph";
export type { OntologyGraphProps } from "./components/OntologyGraph";

export { OntologyMappingGraph } from "./components/OntologyMappingGraph";
export type { OntologyMappingGraphProps } from "./components/OntologyMappingGraph";

export { ProvenancePanel } from "./components/ProvenancePanel";
export type { ProvenancePanelProps } from "./components/ProvenancePanel";

export { FilterBar } from "./components/FilterBar";
export type { FilterBarProps } from "./components/FilterBar";
