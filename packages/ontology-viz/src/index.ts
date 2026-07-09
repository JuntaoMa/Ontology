/**
 * @ontology/viz — Ontology visualization component library
 *
 * Generic, domain-neutral React components for importing,
 * configuring, and visualizing OWL/RDF ontology graphs.
 *
 * ## Quick start
 *
 * ```ts
 * import { OntologyVizApp } from "@ontology/viz";
 * import "@ontology/viz/styles";
 *
 * // Then render <OntologyVizApp />
 * ```
 */

export * from "./core";
export * from "./g6";

// Types — re-export for consumers
export type {
  ExplicitOntologyCardConfig,
  ExplicitOntologyColorMode,
  ExplicitOntologyEdge,
  ExplicitOntologyEdgeConfig,
  ExplicitOntologyEdgeKind,
  ExplicitOntologyEntity,
  ExplicitOntologyEntityKind,
  ExplicitOntologyField,
  ExplicitOntologyFieldKind,
  ExplicitOntologyGraphData,
  ExplicitOntologyLayoutMode,
  ExplicitOntologyParseOptions,
  ExplicitOntologyValue,
  ExplicitOntologyVisualConfig,
} from "./lib/explicitOntologyTypes";

// Parser
export {
  getExplicitOntologyDefaultDescription,
  getExplicitOntologyDefaultLabel,
  getExplicitOntologyDisplayValue,
  getExplicitOntologyFieldValues,
  parseExplicitOntology,
} from "./lib/explicitOntologyParser";

// Components
export {
  ConfigurableOntologyViewer,
  DEFAULT_EXPLICIT_ONTOLOGY_CONFIG,
} from "./components/ConfigurableOntologyViewer";
export type { ConfigurableOntologyViewerProps } from "./components/ConfigurableOntologyViewer";

export { OntologyVizApp } from "./components/OntologyVizApp";
export type { OntologyVizAppProps, OntologyVizSource } from "./components/OntologyVizApp";
