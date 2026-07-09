import type {
  OntologyEdge,
  OntologyEdgeKind,
  OntologyEntity,
  OntologyEntityKind,
} from "../core";

export type OntologyG6LayoutMode = "force-atlas2" | "d3-force" | "antv-dagre";

export interface OntologyG6NodeData {
  id: string;
  type: "circle";
  data: OntologyEntity;
  style: {
    size: number;
    fill: string;
    labelText?: string;
    labelPlacement?: "bottom";
  };
}

export interface OntologyG6EdgeData {
  id: string;
  source: string;
  target: string;
  type: "line";
  data: OntologyEdge;
  style: {
    stroke: string;
    labelText?: string;
    endArrow?: boolean;
  };
}

export interface OntologyG6GraphData {
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

export type OntologyG6LayoutOptions = Record<string, unknown> & {
  type: OntologyG6LayoutMode;
};
