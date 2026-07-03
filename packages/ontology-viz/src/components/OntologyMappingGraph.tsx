import dagre from "@dagrejs/dagre";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";
import { useCallback, useDeferredValue, useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {
  MappingGraphData,
  MappingGraphEdge,
  MappingGraphEdgeData,
  MappingGraphLayoutMode,
  MappingGraphNode,
  MappingGraphNodeData,
  MappingGraphNodeKind,
} from "../lib/mappingGraphTypes";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 112;

const KIND_LABELS: Record<MappingGraphNodeKind, string> = {
  ontologyObject: "对象",
  ontologyRelation: "关系",
  sourceTable: "源表",
};

const KIND_COLORS: Record<MappingGraphNodeKind, string> = {
  ontologyObject: "#2563eb",
  ontologyRelation: "#7c3aed",
  sourceTable: "#0f766e",
};

const EDGE_COLORS = {
  tableToObject: "#0f766e",
  tableToRelation: "#b45309",
  objectToRelation: "#2563eb",
  relationToObject: "#7c3aed",
};

function tint(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function MappingNode({ data }: NodeProps<Node<MappingGraphNodeData>>) {
  const item = data.node;
  const color = KIND_COLORS[item.kind];
  const secondary =
    item.kind === "ontologyObject"
      ? `${item.properties.length} 属性 · ${item.sourceTables.length} 表`
      : item.kind === "ontologyRelation"
        ? `${item.mappings.length} 映射 · ${item.sourceTables.length} 表`
        : `${item.sourceColumns.length} 列 · ${item.mappingIds.length} 映射`;

  return (
    <div
      className={`mapping-graph-node mapping-graph-node--${item.kind} ${data.selected ? "is-selected" : ""}`}
      style={{
        borderColor: color,
        background: `linear-gradient(135deg, ${tint(color, 0.12)}, #fff 72%)`,
        boxShadow: data.selected
          ? `0 0 0 2px ${tint(color, 0.42)}, 0 10px 24px rgba(15, 23, 42, 0.16)`
          : "0 2px 8px rgba(15, 23, 42, 0.1)",
      }}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />

      <div className="mapping-graph-node__meta">
        <span style={{ background: color }}>{KIND_LABELS[item.kind]}</span>
        <small>{item.mappingIds.length} maps</small>
      </div>
      <div className="mapping-graph-node__zh">{item.label.zh}</div>
      <div className="mapping-graph-node__en">{item.label.en}</div>
      <div className="mapping-graph-node__summary">{secondary}</div>
    </div>
  );
}

const nodeTypes = {
  mappingNode: MappingNode,
};

function matchesNode(node: MappingGraphNode, search: string) {
  if (!search) return true;
  const haystack = [
    node.id,
    node.name,
    node.label.en,
    node.label.zh,
    ...node.sourceTables,
    ...(node.sourceColumns ?? []),
    ...(node.kind === "ontologyObject" ? node.properties.flatMap((prop) => [prop.name, prop.label.en, prop.label.zh]) : []),
    ...(node.kind === "ontologyRelation" ? [node.sourceObjectName, node.targetObjectName, node.predicate] : []),
  ].join(" ").toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function visibleIdsForSearch(data: MappingGraphData, search: string) {
  if (!search) return new Set(data.nodes.map((node) => node.id));
  const direct = new Set(data.nodes.filter((node) => matchesNode(node, search)).map((node) => node.id));
  const visible = new Set(direct);
  for (const edge of data.edges) {
    if (direct.has(edge.source) || direct.has(edge.target)) {
      visible.add(edge.source);
      visible.add(edge.target);
    }
  }
  return visible;
}

function buildNodes(data: MappingGraphData, selectedId: string, search: string): Node<MappingGraphNodeData>[] {
  const visibleIds = visibleIdsForSearch(data, search);
  return data.nodes
    .filter((node) => visibleIds.has(node.id))
    .map((node) => ({
      id: node.id,
      type: "mappingNode",
      position: { x: 0, y: 0 },
      draggable: true,
      data: {
        node,
        selected: node.id === selectedId,
      },
    }));
}

function buildEdges(
  data: MappingGraphData,
  visibleNodeIds: Set<string>,
): Edge<MappingGraphEdgeData>[] {
  return data.edges
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    .map((edge) => {
      const color = EDGE_COLORS[edge.kind];
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label.zh,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color,
        },
        data: { edge },
        style: {
          stroke: color,
          strokeWidth: edge.kind === "tableToObject" || edge.kind === "tableToRelation" ? 1.4 : 1.8,
          strokeDasharray: edge.kind.startsWith("table") ? "5 4" : "none",
        },
        labelShowBg: true,
        labelBgStyle: { fill: "rgba(255,255,255,0.92)", fillOpacity: 1 },
        labelStyle: { fontSize: 10, fontWeight: 650, fill: "#334155" },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
      };
    });
}

function layoutDagre(nodes: Node<MappingGraphNodeData>[], edges: Edge<MappingGraphEdgeData>[]) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: 72,
    nodesep: 34,
    edgesep: 12,
    marginx: 18,
    marginy: 18,
  });

  nodes.forEach((node) => graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);

  return nodes.map((node) => {
    const positioned = graph.node(node.id);
    return {
      ...node,
      sourcePosition: Position.Right as const,
      targetPosition: Position.Left as const,
      position: {
        x: (positioned?.x ?? NODE_WIDTH / 2) - NODE_WIDTH / 2,
        y: (positioned?.y ?? NODE_HEIGHT / 2) - NODE_HEIGHT / 2,
      },
    };
  });
}

function layoutForce(nodes: Node<MappingGraphNodeData>[], edges: Edge<MappingGraphEdgeData>[]) {
  if (nodes.length === 0) return nodes;

  const seededNodes = layoutDagre(nodes, edges);
  const bounds = seededNodes.reduce(
    (acc, node) => ({
      minX: Math.min(acc.minX, node.position.x),
      maxX: Math.max(acc.maxX, node.position.x),
      minY: Math.min(acc.minY, node.position.y),
      maxY: Math.max(acc.maxY, node.position.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const simNodes = seededNodes.map((node) => ({
    id: node.id,
    x: node.position.x - centerX,
    y: node.position.y - centerY,
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const simLinks = edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));

  const sim = forceSimulation(simNodes)
    .force("link", forceLink(simLinks).id((d: any) => d.id).distance(230).strength(0.42))
    .force("charge", forceManyBody().strength(-420).distanceMax(1500))
    .force("center", forceCenter(0, 0))
    .force("x", forceX(0).strength(0.026))
    .force("y", forceY(0).strength(0.026))
    .force("collide", forceCollide(NODE_WIDTH * 0.58).strength(0.85).iterations(2))
    .stop();

  for (let index = 0; index < 260; index += 1) sim.tick();

  return nodes.map((node) => {
    const simNode = simNodes.find((item) => item.id === node.id);
    return {
      ...node,
      sourcePosition: Position.Right as const,
      targetPosition: Position.Left as const,
      position: simNode ? { x: simNode.x, y: simNode.y } : node.position,
    };
  });
}

export interface OntologyMappingGraphProps {
  data: MappingGraphData;
  selectedId: string;
  search?: string;
  layoutMode?: MappingGraphLayoutMode;
  onSelect: (id: string) => void;
  onClearSelection?: () => void;
}

export function OntologyMappingGraph(props: OntologyMappingGraphProps) {
  return (
    <ReactFlowProvider>
      <OntologyMappingGraphInner {...props} />
    </ReactFlowProvider>
  );
}

function OntologyMappingGraphInner({
  data,
  selectedId,
  search = "",
  layoutMode = "dagre",
  onSelect,
  onClearSelection,
}: OntologyMappingGraphProps) {
  const { fitView } = useReactFlow();
  const deferredSearch = useDeferredValue(search);

  const { rawNodes, rawEdges } = useMemo(() => {
    const nodes = buildNodes(data, "", deferredSearch.trim());
    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const edges = buildEdges(data, visibleNodeIds);
    const laidOut = layoutMode === "force" ? layoutForce(nodes, edges) : layoutDagre(nodes, edges);
    return { rawNodes: laidOut, rawEdges: edges };
  }, [data, deferredSearch, layoutMode]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<MappingGraphNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<MappingGraphEdgeData>>([]);

  useEffect(() => {
    setNodes(rawNodes);
    setEdges(rawEdges);
    const timer = setTimeout(() => {
      fitView({ padding: 0.08, duration: 320, minZoom: 0.04, maxZoom: 1 });
    }, 100);
    return () => clearTimeout(timer);
  }, [fitView, layoutMode, rawEdges, rawNodes, setEdges, setNodes]);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          selected: node.id === selectedId,
        },
      })),
    );
  }, [selectedId, setNodes]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<MappingGraphNodeData>) => onSelect(node.id),
    [onSelect],
  );

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge<MappingGraphEdgeData>) => onSelect(edge.id),
    [onSelect],
  );

  const nodeColor = useCallback((node: Node<MappingGraphNodeData>) => {
    return KIND_COLORS[node.data.node.kind];
  }, []);

  return (
    <div className="mapping-graph">
      <ReactFlow
        fitView
        proOptions={{ hideAttribution: true }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable
        elementsSelectable
        panOnDrag
        panOnScroll
        autoPanOnNodeDrag
        minZoom={0.04}
        maxZoom={1.6}
        fitViewOptions={{ padding: 0.08, duration: 480, minZoom: 0.04, maxZoom: 1 }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={onClearSelection}
      >
        <MiniMap pannable zoomable nodeColor={nodeColor} nodeStrokeWidth={3} />
        <Controls showInteractive={false} />
        <Background gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}
