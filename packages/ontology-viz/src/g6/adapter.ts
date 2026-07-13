import {
  getOntologyDefaultLabel,
  type OntologyEdgeKind,
  type OntologyEntityKind,
  type OntologyGraphData,
} from "../core";
import type { OntologyG6AdapterOptions, OntologyG6GraphData } from "./types";

export const ONTOLOGY_G6_NODE_SIZE = 36;
export const ONTOLOGY_G6_DEFAULT_SHOW_NODE_LABELS = true;
export const ONTOLOGY_G6_DEFAULT_SHOW_EDGE_LABELS = false;
export const ONTOLOGY_G6_DEFAULT_SHOW_EDGE_ARROWS = true;

export const ONTOLOGY_G6_NODE_COLORS: Record<OntologyEntityKind, string> = {
  Class: "#2563eb",
  ObjectProperty: "#7c3aed",
  DatatypeProperty: "#0f766e",
  AnnotationProperty: "#64748b",
};

export const ONTOLOGY_G6_EDGE_COLORS: Record<OntologyEdgeKind, string> = {
  subClassOf: "#64748b",
  objectRelation: "#7c3aed",
  domain: "#0f766e",
  range: "#2563eb",
  subPropertyOf: "#a16207",
};

export const ONTOLOGY_G6_ENTITY_KINDS: OntologyEntityKind[] = [
  "Class",
  "ObjectProperty",
  "DatatypeProperty",
  "AnnotationProperty",
];

export function toG6GraphData(
  data: OntologyGraphData,
  options: OntologyG6AdapterOptions = {},
): OntologyG6GraphData {
  const visibleKinds = new Set(options.visibleEntityKinds ?? ONTOLOGY_G6_ENTITY_KINDS);
  const nodeSize = options.nodeSize ?? ONTOLOGY_G6_NODE_SIZE;
  const showNodeLabels = options.showNodeLabels ?? ONTOLOGY_G6_DEFAULT_SHOW_NODE_LABELS;
  const showEdgeLabels = options.showEdgeLabels ?? ONTOLOGY_G6_DEFAULT_SHOW_EDGE_LABELS;
  const showEdgeArrows = options.showEdgeArrows ?? ONTOLOGY_G6_DEFAULT_SHOW_EDGE_ARROWS;
  const nodeColorByKind = {
    ...ONTOLOGY_G6_NODE_COLORS,
    ...options.nodeColorByKind,
  };
  const edgeColorByKind = {
    ...ONTOLOGY_G6_EDGE_COLORS,
    ...options.edgeColorByKind,
  };

  const visibleEntities = data.entities.filter((entity) => visibleKinds.has(entity.kind));
  const visibleIds = new Set(visibleEntities.map((entity) => entity.id));

  return {
    nodes: visibleEntities.map((entity) => ({
      id: entity.id,
      type: "circle",
      states: [],
      data: { entity },
      style: {
        size: nodeSize,
        fill: nodeColorByKind[entity.kind],
        fillOpacity: 0.82,
        stroke: "#ffffff",
        strokeOpacity: 0.96,
        lineWidth: 2,
        cursor: "pointer",
        labelText: showNodeLabels ? getOntologyDefaultLabel(entity) : undefined,
        labelPlacement: "bottom",
        labelOffsetY: 4,
        labelFill: "#334155",
        labelFontSize: 10,
        labelFontWeight: 600,
        labelMaxWidth: 120,
        labelOpacity: 0.72,
      },
    })),
    edges: data.edges
      .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "line",
        states: [],
        data: { edge },
        style: {
          stroke: edgeColorByKind[edge.kind],
          strokeOpacity: 0.24,
          lineWidth: 1,
          cursor: "pointer",
          labelText: showEdgeLabels ? edge.label : undefined,
          labelFill: "#475569",
          labelFontSize: 10,
          labelOpacity: 0.72,
          endArrow: showEdgeArrows,
        },
      })),
  };
}
