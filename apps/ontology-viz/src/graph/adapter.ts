import type { GraphData, NodeData } from "@antv/g6";

import type { OntologyDocument, OntologyResource } from "../ontology";
import { PERFORMANCE_LIMITS, RESOURCE_COLORS, RESOURCE_LABELS } from "./tokens";
import type { GraphAdapterOptions } from "./types";

const NODE_SIZE_RANGE = {
  Class: [8, 44],
  NamedIndividual: [4, 30],
} as const;

function nodeSize(resource: OntologyResource, maxDegree: number) {
  const [minimum, maximum] = NODE_SIZE_RANGE[resource.kind as keyof typeof NODE_SIZE_RANGE]
    ?? [6, 32];
  const ratio = maxDegree > 0
    ? Math.log1p(resource.graphDegree) / Math.log1p(maxDegree)
    : 0;
  return Math.round(minimum + (maximum - minimum) * ratio);
}

function createLabelLevels(resources: OntologyResource[]) {
  const byDegree = (left: OntologyResource, right: OntologyResource) => (
    right.graphDegree - left.graphDegree
    || left.label.localeCompare(right.label)
  );
  const classes = resources.filter((resource) => resource.kind === "Class").sort(byDegree);
  const individuals = resources
    .filter((resource) => resource.kind === "NamedIndividual")
    .sort(byDegree);
  const overviewCount = Math.min(
    classes.length,
    Math.max(12, Math.min(30, Math.round(Math.sqrt(classes.length)))),
  );
  const browseCount = Math.min(
    classes.length,
    Math.max(overviewCount, Math.min(120, Math.round(classes.length * 0.12))),
  );
  const detailCount = Math.min(
    classes.length,
    Math.max(browseCount, Math.min(400, Math.round(classes.length * 0.35))),
  );
  const levels = new Map<string, number>();

  classes.forEach((resource, index) => {
    levels.set(
      resource.id,
      index < overviewCount ? 0 : index < browseCount ? 1 : index < detailCount ? 2 : 3,
    );
  });
  individuals.slice(0, 600).forEach((resource) => levels.set(resource.id, 3));
  return levels;
}

function labelTypography(resource: OntologyResource, level: number) {
  if (resource.kind === "NamedIndividual") {
    return { fontSize: 8, fontWeight: 450, maxWidth: 84 };
  }
  const styles = [
    { fontSize: 11, fontWeight: 650, maxWidth: 120 },
    { fontSize: 10, fontWeight: 600, maxWidth: 108 },
    { fontSize: 9, fontWeight: 550, maxWidth: 96 },
    { fontSize: 8, fontWeight: 500, maxWidth: 84 },
  ];
  return styles[level] ?? styles[3];
}

function toNodeData(
  resource: OntologyResource,
  maxDegree: number,
  labelLevel: number,
): NodeData {
  const size = nodeSize(resource, maxDegree);
  const typography = labelTypography(resource, labelLevel);
  return {
    id: resource.id,
    type: "circle",
    data: {
      resourceId: resource.id,
      legend: RESOURCE_LABELS[resource.kind],
      kind: resource.kind,
      degree: resource.graphDegree,
      label: resource.label,
      labelLevel,
      labelFontSize: typography.fontSize,
      labelFontWeight: typography.fontWeight,
      labelMaxWidth: typography.maxWidth,
      size,
    },
    style: {
      size,
      fill: RESOURCE_COLORS[resource.kind],
      fillOpacity: 0.9,
      stroke: "#ffffff",
      strokeOpacity: 0.98,
      lineWidth: 1.5,
      cursor: "pointer",
      labelText: labelLevel === 0 ? resource.label : undefined,
      labelPlacement: "bottom",
      labelOffsetY: 4,
      labelFill: "#4a586b",
      labelFontSize: typography.fontSize,
      labelFontWeight: typography.fontWeight,
      labelWordWrap: true,
      labelMaxLines: 1,
      labelMaxWidth: typography.maxWidth,
      labelTextOverflow: "ellipsis",
      labelOpacity: 0.76,
    },
  };
}

export function toGraphData(
  document: OntologyDocument,
  options: GraphAdapterOptions = {},
): GraphData {
  const resources = document.graph.nodeIds.flatMap((id) => {
    const resource = document.indexes.resourceById.get(id);
    return resource ? [resource] : [];
  });
  const maxDegree = Math.max(0, ...resources.map((resource) => resource.graphDegree));
  const levels = createLabelLevels(resources);
  const showArrows = options.arrows
    ?? document.graph.edges.length <= PERFORMANCE_LIMITS.arrows;

  return {
    nodes: resources.map((resource) => (
      toNodeData(resource, maxDegree, levels.get(resource.id) ?? 3)
    )),
    edges: document.graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "line",
      data: {
        edgeId: edge.id,
        legend: edge.label,
        kind: edge.kind,
      },
      style: {
        stroke: edge.color,
        strokeOpacity: edge.kind === "subClassOf" ? 0.42 : 0.25,
        lineWidth: edge.kind === "subClassOf" ? 1.1 : 0.8,
        increasedLineWidthForHitTesting: 4,
        endArrow: showArrows,
        cursor: "pointer",
      },
    })),
  };
}
