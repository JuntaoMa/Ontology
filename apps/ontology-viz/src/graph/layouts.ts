import type { GraphOptions, NodeData } from "@antv/g6";

import type { LayoutMode } from "./types";

export const LAYOUT_OPTIONS: Array<{ value: LayoutMode; label: string }> = [
  { value: "force-atlas2", label: "ForceAtlas2" },
  { value: "d3-force", label: "D3 Force" },
  { value: "antv-dagre", label: "Dagre" },
  { value: "circular", label: "Circular" },
];

export function createLayout(mode: LayoutMode, nodeCount: number): GraphOptions["layout"] {
  const nodeSize = (node: NodeData) => Math.max(24, Number(node.data?.size) || 6);

  if (mode === "d3-force") {
    return {
      type: "d3-force",
      animation: false,
      iterations: nodeCount > 3_500 ? 120 : 180,
      preventOverlap: true,
      nodeSize,
      nodeSpacing: 16,
      collideStrength: 1,
      collideIterations: 3,
      link: { distance: 180, strength: 0.4 },
      manyBody: { strength: -160 },
      center: { x: 0, y: 0, strength: 0.05 },
      x: { x: 0, strength: 0.05 },
      y: { y: 0, strength: 0.05 },
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
      nodeSize,
      ranker: "network-simplex",
      controlPoints: false,
    };
  }

  if (mode === "circular") {
    return {
      type: "circular",
      animation: false,
      nodeSize,
      nodeSpacing: 18,
      ordering: "degree",
    };
  }

  const iterations = nodeCount > 3_500 ? 100 : 140;
  return [
    {
      type: "force-atlas2",
      animation: false,
      iterations,
      maxIteration: iterations,
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
      nodeSize,
      nodeSpacing: 12,
      collideStrength: 1,
      collideIterations: 3,
      link: false,
      manyBody: false,
      center: false,
      x: false,
      y: false,
    },
  ];
}
