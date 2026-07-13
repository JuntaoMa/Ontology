import type { GraphOptions } from "@antv/g6";

type G6TransformOption = NonNullable<GraphOptions["transforms"]>[number];

export type OntologyG6DegreeDirection = "in" | "out" | "both";
export type OntologyG6NodeSizeScale = "linear" | "log" | "pow" | "sqrt";

export interface OntologyG6DegreeNodeSizeOptions {
  direction?: OntologyG6DegreeDirection;
  minSize?: number;
  maxSize?: number;
  scale?: OntologyG6NodeSizeScale;
}

export const ONTOLOGY_G6_MIN_NODE_SIZE = 24;
export const ONTOLOGY_G6_MAX_NODE_SIZE = 44;

function safeLogScale(
  value: number,
  domain: [number, number],
  range: [number, number],
) {
  const [domainMin, domainMax] = domain;
  const [rangeMin, rangeMax] = range;
  if (domainMax <= domainMin) return rangeMin;

  const ratio = Math.log(value - domainMin + 1) / Math.log(domainMax - domainMin + 1);
  return rangeMin + ratio * (rangeMax - rangeMin);
}

export function createG6DegreeNodeSizeTransform(
  options: OntologyG6DegreeNodeSizeOptions = {},
): G6TransformOption {
  return {
    type: "map-node-size",
    key: "ontology-degree-node-size",
    centrality: {
      type: "degree",
      direction: options.direction ?? "both",
    },
    minSize: options.minSize ?? ONTOLOGY_G6_MIN_NODE_SIZE,
    maxSize: options.maxSize ?? ONTOLOGY_G6_MAX_NODE_SIZE,
    scale: options.scale === undefined || options.scale === "log"
      ? safeLogScale
      : options.scale,
    mapLabelSize: false,
  };
}
