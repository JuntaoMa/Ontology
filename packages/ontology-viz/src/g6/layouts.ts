import type { OntologyG6LayoutMode, OntologyG6LayoutOptions } from "./types";

export const ONTOLOGY_G6_LAYOUT_MODES: OntologyG6LayoutMode[] = [
  "force-atlas2",
  "d3-force",
  "antv-dagre",
];

export function createG6LayoutOptions(
  mode: OntologyG6LayoutMode = "force-atlas2",
  nodeSize?: number,
): OntologyG6LayoutOptions {
  const explicitNodeSize = nodeSize === undefined ? {} : { nodeSize };

  if (mode === "d3-force") {
    return {
      type: "d3-force",
      animation: false,
      iterations: 180,
      preventOverlap: true,
      nodeSpacing: 16,
      collideStrength: 1,
      collideIterations: 3,
      ...explicitNodeSize,
      link: {
        distance: 180,
        strength: 0.4,
      },
      manyBody: {
        strength: -160,
      },
      center: {
        x: 0,
        y: 0,
        strength: 0.05,
      },
      x: {
        x: 0,
        strength: 0.05,
      },
      y: {
        y: 0,
        strength: 0.05,
      },
    };
  }

  if (mode === "antv-dagre") {
    return {
      type: "antv-dagre",
      animation: false,
      rankdir: "LR",
      align: "UL",
      nodesep: 44,
      ranksep: 120,
      ...explicitNodeSize,
      ranker: "network-simplex",
      controlPoints: false,
    };
  }

  return [
    {
      type: "force-atlas2",
      animation: false,
      iterations: 140,
      maxIteration: 140,
      preventOverlap: false,
      kr: 44,
      kg: 0.9,
      mode: "normal",
      barnesHut: true,
      prune: false,
      enableWorker: false,
    },
    {
      type: "d3-force",
      animation: false,
      iterations: 60,
      preventOverlap: true,
      nodeSpacing: 12,
      collideStrength: 1,
      collideIterations: 3,
      ...explicitNodeSize,
      link: false,
      manyBody: false,
      center: false,
      x: false,
      y: false,
    },
  ];
}
