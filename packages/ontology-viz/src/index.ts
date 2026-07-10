/**
 * @ontology/viz — Ontology visualization component library
 *
 * Generic, domain-neutral modules for parsing, adapting,
 * and visualizing OWL/RDF ontology graphs.
 *
 * ## Quick start
 *
 * ```ts
 * import { parseOntology } from "@ontology/viz/core";
 * import { OntologyGraphCanvas } from "@ontology/viz/react";
 * import { OntologyVizApp } from "@ontology/viz/standalone";
 * ```
 */

export * from "./core";
export * from "./g6";
export * from "./react";

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
