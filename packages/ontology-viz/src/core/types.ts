import type {
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
} from "../lib/explicitOntologyTypes";

export type OntologyEntityKind = ExplicitOntologyEntityKind;
export type OntologyEdgeKind = ExplicitOntologyEdgeKind;
export type OntologyLayoutMode = ExplicitOntologyLayoutMode;
export type OntologyColorMode = ExplicitOntologyColorMode;
export type OntologyFieldKind = ExplicitOntologyFieldKind;

export type OntologyValue = ExplicitOntologyValue;
export type OntologyField = ExplicitOntologyField;
export type OntologyEntity = ExplicitOntologyEntity;
export type OntologyEdge = ExplicitOntologyEdge;
export type OntologyGraphData = ExplicitOntologyGraphData;
export type OntologyCardConfig = ExplicitOntologyCardConfig;
export type OntologyEdgeConfig = ExplicitOntologyEdgeConfig;
export type OntologyVisualConfig = ExplicitOntologyVisualConfig;
export type OntologyParseOptions = ExplicitOntologyParseOptions;

export interface OntologyLayoutPosition {
  x: number;
  y: number;
  z?: number;
}

export interface OntologyLayoutSnapshot {
  nodes: Record<string, OntologyLayoutPosition>;
  updatedAt?: number;
}
