export type {
  OntologyCardConfig,
  OntologyColorMode,
  OntologyEdge,
  OntologyEdgeConfig,
  OntologyEdgeKind,
  OntologyEntity,
  OntologyEntityKind,
  OntologyField,
  OntologyFieldKind,
  OntologyGraphData,
  OntologyLayoutPosition,
  OntologyLayoutMode,
  OntologyLayoutSnapshot,
  OntologyParseOptions,
  OntologyValue,
  OntologyVisualConfig,
} from "./types";

export {
  getOntologyDefaultDescription,
  getOntologyDefaultLabel,
  getOntologyDisplayValue,
  getOntologyFieldValues,
  parseOntology,
} from "./parseOntology";
