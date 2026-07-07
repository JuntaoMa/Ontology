import dagre from "@dagrejs/dagre";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

export type GraphLayoutMode = "layered" | "force";

export interface GraphLayoutNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
}

export interface GraphLayoutEdge {
  source: string;
  target: string;
}

export interface GraphLayoutPosition {
  id: string;
  x: number;
  y: number;
}

export interface LayeredGraphLayoutOptions {
  rankdir: "TB" | "BT" | "LR" | "RL";
  ranksep: number;
  nodesep: number;
  edgesep: number;
  marginx: number;
  marginy: number;
}

export interface ForceGraphLayoutOptions {
  linkDistance: number;
  linkStrength: number;
  chargeStrength: number;
  chargeDistanceMax: number;
  collideRadius: number;
  collideStrength: number;
  collideIterations: number;
  ticks: number;
  centerStrength: number;
  spreadFactor: number;
}

export interface GraphLayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  layered?: Partial<LayeredGraphLayoutOptions>;
  force?: Partial<ForceGraphLayoutOptions>;
}

interface ForceLayoutNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
}

type ForceLayoutLink = SimulationLinkDatum<ForceLayoutNode>;

const DEFAULT_LAYERED_OPTIONS: LayeredGraphLayoutOptions = {
  rankdir: "LR",
  ranksep: 72,
  nodesep: 34,
  edgesep: 12,
  marginx: 18,
  marginy: 18,
};

const DEFAULT_FORCE_OPTIONS: ForceGraphLayoutOptions = {
  linkDistance: 80,
  linkStrength: 0.6,
  chargeStrength: 200,
  chargeDistanceMax: 800,
  collideRadius: 20,
  collideStrength: 0.8,
  collideIterations: 2,
  ticks: 300,
  centerStrength: 0.02,
  spreadFactor: 80,
};

function toPositionMap(positions: GraphLayoutPosition[]) {
  return new Map(positions.map((position) => [position.id, { x: position.x, y: position.y }]));
}

export function layoutLayeredGraph(
  nodes: GraphLayoutNode[],
  edges: GraphLayoutEdge[],
  options: GraphLayoutOptions,
) {
  const layered = { ...DEFAULT_LAYERED_OPTIONS, ...options.layered };
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph(layered);

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: node.width ?? options.nodeWidth,
      height: node.height ?? options.nodeHeight,
    });
  });
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));

  dagre.layout(graph);

  return nodes.map((node) => {
    const positioned = graph.node(node.id);
    return {
      id: node.id,
      x: positioned?.x ?? 0,
      y: positioned?.y ?? 0,
    };
  });
}

export function layoutForceGraph(
  nodes: GraphLayoutNode[],
  edges: GraphLayoutEdge[],
  options: GraphLayoutOptions,
) {
  if (nodes.length === 0) return [];

  const force = { ...DEFAULT_FORCE_OPTIONS, ...options.force };
  const spread = Math.sqrt(nodes.length) * force.spreadFactor;
  const simNodes: ForceLayoutNode[] = nodes.map((node) => ({
    id: node.id,
    x: node.x ?? (Math.random() - 0.5) * spread * 2,
    y: node.y ?? (Math.random() - 0.5) * spread * 2,
  }));
  const ids = new Set(nodes.map((node) => node.id));
  const links: ForceLayoutLink[] = edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));

  const sim = forceSimulation<ForceLayoutNode>(simNodes)
    .force(
      "link",
      forceLink<ForceLayoutNode, ForceLayoutLink>(links)
        .id((node) => node.id)
        .distance(force.linkDistance)
        .strength(force.linkStrength),
    )
    .force("charge", forceManyBody<ForceLayoutNode>().strength(-force.chargeStrength).distanceMax(force.chargeDistanceMax))
    .force("center", forceCenter<ForceLayoutNode>(0, 0))
    .force("x", forceX<ForceLayoutNode>(0).strength(force.centerStrength))
    .force("y", forceY<ForceLayoutNode>(0).strength(force.centerStrength))
    .force(
      "collide",
      forceCollide<ForceLayoutNode>(force.collideRadius)
        .strength(force.collideStrength)
        .iterations(force.collideIterations),
    )
    .stop();

  for (let index = 0; index < force.ticks; index += 1) sim.tick();

  return simNodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
  }));
}

export function layoutGraph(
  nodes: GraphLayoutNode[],
  edges: GraphLayoutEdge[],
  mode: GraphLayoutMode,
  options: GraphLayoutOptions,
) {
  const positions = mode === "force"
    ? layoutForceGraph(nodes, edges, options)
    : layoutLayeredGraph(nodes, edges, options);
  return toPositionMap(positions);
}
