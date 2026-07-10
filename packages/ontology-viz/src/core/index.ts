export type {
  OntologyEdge,
  OntologyEdgeKind,
  OntologyEntity,
  OntologyEntityKind,
  OntologyField,
  OntologyFieldKind,
  OntologyGraphData,
  OntologyLayoutPosition,
  OntologyLayoutSnapshot,
  OntologyParseOptions,
  OntologyValue,
} from "./types";

export {
  getOntologyDefaultDescription,
  getOntologyDefaultLabel,
  getOntologyDisplayValue,
  getOntologyFieldValues,
  parseOntology,
} from "./parseOntology";
