import {
  getOntologyDefaultLabel,
  type OntologyEdgeKind,
  type OntologyEntityKind,
  type OntologyGraphData,
} from "../core";
import type { OntologyG6AdapterOptions, OntologyG6GraphData } from "./types";

export const ONTOLOGY_G6_NODE_SIZE = 36;

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

const DEFAULT_VISIBLE_ENTITY_KINDS: OntologyEntityKind[] = [
  "Class",
  "ObjectProperty",
  "DatatypeProperty",
  "AnnotationProperty",
];

export function toG6GraphData(
  data: OntologyGraphData,
  options: OntologyG6AdapterOptions = {},
): OntologyG6GraphData {
  const visibleKinds = new Set(options.visibleEntityKinds ?? DEFAULT_VISIBLE_ENTITY_KINDS);
  const nodeSize = options.nodeSize ?? ONTOLOGY_G6_NODE_SIZE;
  const showNodeLabels = options.showNodeLabels ?? true;
  const showEdgeLabels = options.showEdgeLabels ?? true;
  const showEdgeArrows = options.showEdgeArrows ?? true;
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
      data: entity,
      style: {
        size: nodeSize,
        fill: nodeColorByKind[entity.kind],
        labelText: showNodeLabels ? getOntologyDefaultLabel(entity) : undefined,
        labelPlacement: "bottom",
      },
    })),
    edges: data.edges
      .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "line",
        data: edge,
        style: {
          stroke: edgeColorByKind[edge.kind],
          labelText: showEdgeLabels ? edge.label : undefined,
          endArrow: showEdgeArrows,
        },
      })),
  };
}
