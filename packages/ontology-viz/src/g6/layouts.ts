import { ONTOLOGY_G6_NODE_SIZE } from "./adapter";
import type { OntologyG6LayoutMode, OntologyG6LayoutOptions } from "./types";

export const ONTOLOGY_G6_LAYOUT_MODES: OntologyG6LayoutMode[] = [
  "force-atlas2",
  "d3-force",
  "antv-dagre",
];

export function createG6LayoutOptions(
  mode: OntologyG6LayoutMode = "force-atlas2",
  nodeSize = ONTOLOGY_G6_NODE_SIZE,
): OntologyG6LayoutOptions {
  if (mode === "d3-force") {
    return {
      type: "d3-force",
      link: {
        distance: 120,
        strength: 0.45,
      },
      manyBody: {
        strength: -120,
      },
      collide: {
        radius: nodeSize / 2 + 6,
        strength: 1,
        iterations: 2,
      },
      center: {
        x: 0,
        y: 0,
        strength: 0.08,
      },
    };
  }

  if (mode === "antv-dagre") {
    return {
      type: "antv-dagre",
      rankdir: "LR",
      align: "UL",
      nodesep: 44,
      ranksep: 120,
      nodeSize: [nodeSize, nodeSize],
      ranker: "network-simplex",
      controlPoints: false,
    };
  }

  return {
    type: "force-atlas2",
    preventOverlap: true,
    nodeSize,
    nodeSpacing: 8,
    kr: 22,
    kg: 1.2,
    linLog: true,
    barnesHut: true,
    prune: true,
    enableWorker: true,
  };
}
