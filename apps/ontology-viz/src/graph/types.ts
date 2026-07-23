import type { OntologyDocument } from "../ontology";

export type LayoutMode =
  | "force-atlas2"
  | "d3-force"
  | "antv-dagre"
  | "circular";

export interface LayoutPosition {
  x: number;
  y: number;
  z?: number;
}

export interface LayoutSnapshot {
  nodes: Record<string, LayoutPosition>;
  updatedAt: number;
}

export interface GraphAdapterOptions {
  arrows?: boolean;
}

export interface GraphCanvasProps {
  document: OntologyDocument;
  layoutMode: LayoutMode;
  layoutSnapshot?: LayoutSnapshot;
  selectedElementId?: string;
  onNodeSelect: (id: string) => void;
  onEdgeSelect: (id: string) => void;
  onCanvasClick: () => void;
  onOpenSettings: () => void;
  onBusyChange?: (message: string) => void;
  onLayoutSnapshotChange?: (snapshot: LayoutSnapshot) => void;
}
