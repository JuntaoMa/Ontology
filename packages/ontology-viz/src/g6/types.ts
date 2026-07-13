import type { EdgeData, GraphData, GraphOptions, NodeData } from "@antv/g6";

import type { OntologyEdge, OntologyEdgeKind, OntologyEntity, OntologyEntityKind } from "../core";

export type OntologyG6LayoutMode = "force-atlas2" | "d3-force" | "antv-dagre";

export interface OntologyG6NodeCustomData extends Record<string, unknown> {
  entity: OntologyEntity;
}

export interface OntologyG6EdgeCustomData extends Record<string, unknown> {
  edge: OntologyEdge;
}

export interface OntologyG6NodeData extends NodeData {
  id: string;
  type: "circle";
  data: OntologyG6NodeCustomData;
  style: {
    size: number;
    fill: string;
    labelText?: string;
    labelPlacement?: "bottom";
  };
}

export interface OntologyG6EdgeData extends EdgeData {
  id: string;
  source: string;
  target: string;
  type: "line";
  data: OntologyG6EdgeCustomData;
  style: {
    stroke: string;
    labelText?: string;
    endArrow?: boolean;
  };
}

export interface OntologyG6GraphData extends GraphData {
  nodes: OntologyG6NodeData[];
  edges: OntologyG6EdgeData[];
}

export interface OntologyG6AdapterOptions {
  visibleEntityKinds?: OntologyEntityKind[];
  nodeSize?: number;
  showNodeLabels?: boolean;
  showEdgeLabels?: boolean;
  showEdgeArrows?: boolean;
  nodeColorByKind?: Partial<Record<OntologyEntityKind, string>>;
  edgeColorByKind?: Partial<Record<OntologyEdgeKind, string>>;
}

export type OntologyG6LayoutOptions = NonNullable<GraphOptions["layout"]>;
