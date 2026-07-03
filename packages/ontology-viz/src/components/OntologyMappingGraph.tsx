import dagre from "@dagrejs/dagre";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { memo, useCallback, useDeferredValue, useEffect, useMemo } from "react";
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

const NODE_WIDTH = 280;
const NODE_HEIGHT = 110;
const NODE_GAP = 340;

interface LayoutSimNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
}

const KIND_LABELS: Record<MappingGraphNodeKind, string> = {
  ontologyObject: "对象",
  sourceTable: "源表",
};

const KIND_COLORS: Record<MappingGraphNodeKind, string> = {
  ontologyObject: "#2563eb",
  sourceTable: "#0f766e",
};

const EDGE_COLORS = {
  tableToObject: "#0f766e",
  objectRelation: "#7c3aed",
};

function tint(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const MappingNode = memo(function MappingNode({ data }: NodeProps<Node<MappingGraphNodeData>>) {
  const item = data.node;
  const color = KIND_COLORS[item.kind];
  const secondary =
    item.kind === "ontologyObject"
      ? `${item.properties.length} 属性 · ${item.sourceTables.length} 表`
      : `${item.sourceColumns.length} 列 · ${item.mappingIds.length} 映射`;

  return (
    <div
      className={[
        "mapping-graph-node",
        `mapping-graph-node--${item.kind}`,
        data.selected ? "is-selected" : "",
        data.highlighted ? "is-highlighted" : "",
        data.dimmed ? "is-dimmed" : "",
      ].filter(Boolean).join(" ")}
      style={{
        borderLeft: `4px solid ${color}`,
        background: `linear-gradient(135deg, ${tint(color, 0.12)} 0%, ${tint(color, 0.04)} 100%), #fff`,
        boxShadow: data.selected
          ? `0 0 0 2px ${color}, 0 4px 12px rgba(0,0,0,0.1)`
          : data.highlighted
            ? `0 0 0 2px ${tint(color, 0.45)}, 0 4px 12px rgba(0,0,0,0.1)`
            : "0 1px 3px rgba(0,0,0,0.08)",
      }}
    >
      <Handle
        id="center-target"
        className="mapping-graph-node__center-handle"
        type="target"
        position={Position.Top}
      />
      <Handle
        id="center-source"
        className="mapping-graph-node__center-handle"
        type="source"
        position={Position.Top}
      />

      <div className="mapping-graph-node__meta">
        <span style={{ background: color }}>{KIND_LABELS[item.kind]}</span>
        <small>{item.mappingIds.length} maps</small>
      </div>
      <div className="mapping-graph-node__zh">{item.label.zh}</div>
      <div className="mapping-graph-node__en">{item.label.en}</div>
      <div className="mapping-graph-node__summary">{secondary}</div>
    </div>
  );
});

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
  ].join(" ").toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function matchesEdge(edge: MappingGraphEdge, search: string) {
  if (!search) return true;
  const haystack = [
    edge.id,
    edge.name ?? "",
    edge.predicate ?? "",
    edge.label.en,
    edge.label.zh,
    edge.sourceObjectName ?? "",
    edge.targetObjectName ?? "",
    ...edge.sourceTables,
    ...edge.sourceColumns,
    ...edge.targetProperties,
    ...edge.mappings.flatMap((mapping) => [
      mapping.mappingId,
      mapping.abstraction,
      mapping.targetProperty ?? "",
      mapping.targetLabel?.en ?? "",
      mapping.targetLabel?.zh ?? "",
      ...(mapping.sourceTables ?? []),
      ...mapping.sourceColumns,
    ]),
  ].join(" ").toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function visibleIdsForSearch(data: MappingGraphData, search: string) {
  if (!search) return new Set(data.nodes.map((node) => node.id));
  const direct = new Set(data.nodes.filter((node) => matchesNode(node, search)).map((node) => node.id));
  const visible = new Set(direct);
  for (const edge of data.edges) {
    if (direct.has(edge.source) || direct.has(edge.target) || matchesEdge(edge, search)) {
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
        highlighted: false,
        dimmed: false,
      },
    }));
}

function edgeBaseStyle(edge: MappingGraphEdge, state: { selected?: boolean; highlighted?: boolean; dimmed?: boolean } = {}) {
  const color = EDGE_COLORS[edge.kind];
  return {
    stroke: color,
    strokeWidth: state.selected
      ? edge.kind === "objectRelation" ? 3.4 : 2.6
      : state.highlighted
        ? edge.kind === "objectRelation" ? 2.8 : 2.1
        : edge.kind === "objectRelation" ? 2 : 1.4,
    strokeDasharray: edge.kind === "tableToObject" ? "5 4" : "none",
  };
}

function edgeLabelStyle(state: { selected?: boolean; highlighted?: boolean; dimmed?: boolean } = {}) {
  return {
    fontSize: 10,
    fontWeight: state.selected || state.highlighted ? 760 : 650,
    fill: "#334155",
  };
}

function shouldShowEdgeLabel(
  edge: MappingGraphEdge,
  state: { selected?: boolean; highlighted?: boolean } = {},
) {
  return edge.kind === "objectRelation" || Boolean(state.selected || state.highlighted);
}

function edgeClassName(state: { selected?: boolean; highlighted?: boolean; dimmed?: boolean } = {}) {
  return [
    state.selected ? "is-selected" : "",
    state.highlighted ? "is-highlighted" : "",
    state.dimmed ? "is-dimmed" : "",
  ].filter(Boolean).join(" ");
}

function edgeHasState(
  edge: Edge<MappingGraphEdgeData>,
  state: { selected?: boolean; highlighted?: boolean; dimmed?: boolean },
) {
  return (
    Boolean(edge.data?.selected) === Boolean(state.selected) &&
    Boolean(edge.data?.highlighted) === Boolean(state.highlighted)
  );
}

function buildEdges(
  data: MappingGraphData,
  visibleNodeIds: Set<string>,
): Edge<MappingGraphEdgeData>[] {
  return data.edges
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    .map((edge) => {
      const color = EDGE_COLORS[edge.kind];
      const showLabel = shouldShowEdgeLabel(edge);
      return {
        id: edge.id,
        type: "straight",
        source: edge.source,
        sourceHandle: "center-source",
        target: edge.target,
        targetHandle: "center-target",
        label: showLabel ? edge.label.zh : undefined,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color,
        },
        data: { edge },
        style: edgeBaseStyle(edge),
        labelShowBg: showLabel,
        labelBgStyle: { fill: "rgba(255,255,255,0.92)", fillOpacity: 1 },
        labelStyle: edgeLabelStyle(),
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
      };
    });
}

function forceCircleBoundary(radius: number) {
  let nodes: LayoutSimNode[] = [];
  const maxDistance = Math.max(0, radius - Math.hypot(NODE_WIDTH, NODE_HEIGHT) / 2);

  const force = (() => {
    for (const node of nodes) {
      const distance = Math.hypot(node.x, node.y);
      if (distance <= maxDistance || distance === 0) continue;

      const ratio = maxDistance / distance;
      node.x *= ratio;
      node.y *= ratio;
      node.vx = (node.vx ?? 0) * 0.25;
      node.vy = (node.vy ?? 0) * 0.25;
    }
  }) as (() => void) & { initialize: (nextNodes: LayoutSimNode[]) => void };

  force.initialize = (nextNodes: LayoutSimNode[]) => {
    nodes = nextNodes;
  };

  return force;
}

function averageAngle(angles: number[]) {
  if (angles.length === 0) return Number.POSITIVE_INFINITY;
  const vector = angles.reduce(
    (acc, angle) => ({
      x: acc.x + Math.cos(angle),
      y: acc.y + Math.sin(angle),
    }),
    { x: 0, y: 0 },
  );
  return Math.atan2(vector.y, vector.x);
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
      sourcePosition: Position.Top as const,
      targetPosition: Position.Top as const,
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
      sourcePosition: Position.Top as const,
      targetPosition: Position.Top as const,
      position: simNode ? { x: simNode.x, y: simNode.y } : node.position,
    };
  });
}

function layoutRadial(nodes: Node<MappingGraphNodeData>[], edges: Edge<MappingGraphEdgeData>[]) {
  if (nodes.length === 0) return nodes;

  const objectNodes = nodes.filter((node) => node.data.node.kind === "ontologyObject");
  const tableNodes = nodes.filter((node) => node.data.node.kind === "sourceTable");
  const objectIds = new Set(objectNodes.map((node) => node.id));
  const objectEdges = edges.filter(
    (edge) =>
      edge.data?.edge.kind === "objectRelation" &&
      objectIds.has(edge.source) &&
      objectIds.has(edge.target),
  );
  const degree = new Map(objectNodes.map((node) => [node.id, 0]));

  for (const edge of objectEdges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const sortedObjects = [...objectNodes].sort((a, b) =>
    (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
    a.data.node.label.en.localeCompare(b.data.node.label.en),
  );
  const innerRadius = Math.max(900, Math.ceil(Math.sqrt(Math.max(1, objectNodes.length)) * 205));
  const seedRadius = innerRadius * 0.68;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const simNodes: LayoutSimNode[] = sortedObjects.map((node, index) => {
    const radius = seedRadius * Math.sqrt((index + 0.5) / Math.max(1, sortedObjects.length));
    const angle = index * goldenAngle;
    return {
      id: node.id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
  const simLinks = objectEdges.map((edge) => ({ source: edge.source, target: edge.target }));

  const sim = forceSimulation<LayoutSimNode>(simNodes)
    .force(
      "link",
      forceLink<LayoutSimNode, any>(simLinks)
        .id((d: any) => d.id)
        .distance(270)
        .strength(0.34),
    )
    .force("charge", forceManyBody().strength(-520).distanceMax(innerRadius * 0.9))
    .force("center", forceCenter(0, 0))
    .force("radial", forceRadial(innerRadius * 0.44, 0, 0).strength(0.018))
    .force("x", forceX(0).strength(0.018))
    .force("y", forceY(0).strength(0.018))
    .force("collide", forceCollide(NODE_WIDTH * 0.58).strength(0.92).iterations(3))
    .force("boundary", forceCircleBoundary(innerRadius))
    .stop();

  for (let index = 0; index < 240; index += 1) sim.tick();

  const simById = new Map(simNodes.map((node) => [node.id, node]));
  const positioned = new Map<string, { x: number; y: number; angle: number }>();

  for (const node of objectNodes) {
    const simNode = simById.get(node.id);
    if (!simNode) continue;
    positioned.set(node.id, {
      x: simNode.x - NODE_WIDTH / 2,
      y: simNode.y - NODE_HEIGHT / 2,
      angle: Math.atan2(simNode.y, simNode.x),
    });
  }

  const objectAngles = new Map([...positioned.entries()].map(([id, pos]) => [id, pos.angle]));
  const tableAngles = tableNodes.map((node) => {
    const linkedAngles: number[] = [];
    for (const edge of edges) {
      if (edge.data?.edge.kind !== "tableToObject") continue;
      if (edge.source === node.id && objectAngles.has(edge.target)) {
        linkedAngles.push(objectAngles.get(edge.target)!);
      } else if (edge.target === node.id && objectAngles.has(edge.source)) {
        linkedAngles.push(objectAngles.get(edge.source)!);
      }
    }

    return { node, angle: averageAngle(linkedAngles) };
  }).sort((a, b) => a.angle - b.angle || a.node.data.node.label.en.localeCompare(b.node.data.node.label.en));

  const tableRadius = Math.max(
    innerRadius + 980,
    tableNodes.length > 0 ? (tableNodes.length * NODE_GAP) / (2 * Math.PI) : innerRadius + 980,
  );

  tableAngles.forEach(({ node }, tableIndex) => {
    const angle = -Math.PI + (tableIndex / Math.max(1, tableAngles.length)) * 2 * Math.PI;
    positioned.set(node.id, {
      x: Math.cos(angle) * tableRadius - NODE_WIDTH / 2,
      y: Math.sin(angle) * tableRadius - NODE_HEIGHT / 2,
      angle,
    });
  });

  return nodes.map((node) => {
    const pos = positioned.get(node.id);
    return {
      ...node,
      position: pos ? { x: pos.x, y: pos.y } : node.position,
    };
  });
}

function selectionSets(
  selectedId: string,
  nodes: Node<MappingGraphNodeData>[],
  edges: Edge<MappingGraphEdgeData>[],
) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const highlightedNodes = new Set<string>();
  const highlightedEdges = new Set<string>();
  const selectedNodeId = nodeIds.has(selectedId) ? selectedId : "";
  const selectedEdgeId = edgeIds.has(selectedId) ? selectedId : "";

  if (!selectedId) {
    return { selectedNodeId, selectedEdgeId, highlightedNodes, highlightedEdges };
  }

  if (selectedNodeId) {
    highlightedNodes.add(selectedNodeId);
    for (const edge of edges) {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        highlightedEdges.add(edge.id);
        highlightedNodes.add(edge.source);
        highlightedNodes.add(edge.target);
      }
    }
    return { selectedNodeId, selectedEdgeId, highlightedNodes, highlightedEdges };
  }

  if (selectedEdgeId) {
    const edge = edges.find((item) => item.id === selectedEdgeId);
    if (edge) {
      highlightedEdges.add(edge.id);
      highlightedNodes.add(edge.source);
      highlightedNodes.add(edge.target);
    }
  }

  return { selectedNodeId, selectedEdgeId, highlightedNodes, highlightedEdges };
}

function applyEdgeState(
  edge: Edge<MappingGraphEdgeData>,
  state: { selected?: boolean; highlighted?: boolean; dimmed?: boolean },
): Edge<MappingGraphEdgeData> {
  const mappingEdge = edge.data?.edge;
  if (!mappingEdge) return edge;
  const showLabel = shouldShowEdgeLabel(mappingEdge, state);
  return {
    ...edge,
    label: showLabel ? mappingEdge.label.zh : undefined,
    labelShowBg: showLabel,
    className: edgeClassName(state),
    style: edgeBaseStyle(mappingEdge, state),
    labelStyle: edgeLabelStyle(state),
    data: {
      ...(edge.data ?? {}),
      edge: mappingEdge,
      selected: Boolean(state.selected),
      highlighted: Boolean(state.highlighted),
      dimmed: Boolean(state.dimmed),
    },
  };
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
    const laidOut = layoutMode === "force"
      ? layoutForce(nodes, edges)
      : layoutMode === "radial"
        ? layoutRadial(nodes, edges)
        : layoutDagre(nodes, edges);
    return { rawNodes: laidOut, rawEdges: edges };
  }, [data, deferredSearch, layoutMode]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<MappingGraphNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<MappingGraphEdgeData>>([]);
  const fitDuration = nodes.length > 160 || edges.length > 260 ? 0 : 320;
  const fitViewOptions = useMemo(
    () => ({ padding: 0.08, duration: fitDuration, minZoom: 0.04, maxZoom: 1 }),
    [fitDuration],
  );
  const hasActiveSelection = useMemo(
    () => Boolean(selectedId) && (
      rawNodes.some((node) => node.id === selectedId) ||
      rawEdges.some((edge) => edge.id === selectedId)
    ),
    [rawEdges, rawNodes, selectedId],
  );

  useEffect(() => {
    setNodes(rawNodes);
    setEdges(rawEdges);
    const timer = setTimeout(() => {
      fitView({
        padding: 0.08,
        duration: rawNodes.length > 160 || rawEdges.length > 260 ? 0 : 320,
        minZoom: 0.04,
        maxZoom: 1,
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [fitView, layoutMode, rawEdges, rawNodes, setEdges, setNodes]);

  useEffect(() => {
    const sets = selectionSets(selectedId, rawNodes, rawEdges);
    setNodes((current) =>
      current.map((node) => {
        const selected = node.id === sets.selectedNodeId;
        const highlighted = sets.highlightedNodes.has(node.id);
        if (
          node.data.selected === selected &&
          node.data.highlighted === highlighted &&
          node.data.dimmed === false
        ) {
          return node;
        }
        return {
          ...node,
          data: {
            ...node.data,
            selected,
            highlighted,
            dimmed: false,
          },
        };
      }),
    );
    setEdges((current) =>
      current.map((edge) => {
        const highlighted = sets.highlightedEdges.has(edge.id);
        const state = {
          selected: edge.id === sets.selectedEdgeId,
          highlighted,
          dimmed: false,
        };
        return edgeHasState(edge, state) ? edge : applyEdgeState(edge, state);
      }),
    );
  }, [rawEdges, rawNodes, selectedId, setEdges, setNodes]);

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
    <div className={`mapping-graph ${hasActiveSelection ? "has-selection" : ""}`}>
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
        onlyRenderVisibleElements
        minZoom={0.04}
        maxZoom={1.6}
        fitViewOptions={fitViewOptions}
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
