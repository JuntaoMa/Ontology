import dagre from "@dagrejs/dagre";
import { useDeferredValue, useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  Position,
  useEdgesState,
  useNodesState,
  MarkerType,
} from "@xyflow/react";
import type { DomainBundle, GraphMode, ResourceType } from "../utils/types";
import { resourceKey } from "../utils/resources";
import { TypeBadge } from "./TypeBadge";

type GraphNodeType = Extract<ResourceType, "Object" | "Function" | "Action">;

type GraphNodeData = {
  resourceType: GraphNodeType;
  resourceId: string;
  resourceKey: string;
  name: string;
  summary: string;
  selected: boolean;
};

type GraphEdgeData = {
  resourceType: "Link" | "Capability";
  resourceId: string;
  resourceKey: string;
  baseClassName: string;
  summary?: string;
};

const NODE_WIDTH = 320;
const NODE_HEIGHT = 148;

function ResourceNode({ data }: NodeProps<Node<GraphNodeData>>) {
  return (
    <div className={`resource-node resource-node--${data.resourceType.toLowerCase()} ${data.selected ? "is-selected" : ""}`}>
      <Handle className="resource-node__handle" type="target" position={Position.Left} />
      <Handle className="resource-node__handle" type="source" position={Position.Right} />
      <Handle className="resource-node__handle" type="target" position={Position.Top} />
      <Handle className="resource-node__handle" type="source" position={Position.Bottom} />
      <div className="resource-node__header">
        <TypeBadge type={data.resourceType} />
        <span className="resource-node__id">{data.resourceId}</span>
      </div>
      <div className="resource-node__name">{data.name}</div>
      <div className="resource-node__summary">{data.summary}</div>
    </div>
  );
}

const nodeTypes = {
  resource: ResourceNode,
};

function buildNodeRecord(bundle: DomainBundle) {
  return [
    ...bundle.objects.map((item) => ({
      id: resourceKey("Object", item.id),
      resourceType: "Object" as const,
      resourceId: item.id,
      name: item.name,
      summary: item.summary,
    })),
    ...bundle.functions.map((item) => ({
      id: resourceKey("Function", item.id),
      resourceType: "Function" as const,
      resourceId: item.id,
      name: item.name,
      summary: item.summary,
    })),
    ...bundle.actions.map((item) => ({
      id: resourceKey("Action", item.id),
      resourceType: "Action" as const,
      resourceId: item.id,
      name: item.name,
      summary: item.summary,
    })),
  ];
}

function buildSemanticEdges(bundle: DomainBundle): Edge<GraphEdgeData>[] {
  return bundle.links.map((link) => ({
    id: `semantic:${link.id}`,
    source: resourceKey("Object", link.fromObject),
    target: resourceKey("Object", link.toObject),
    label: link.name,
    type: "default",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
      color: "rgba(15, 118, 110, 0.64)",
    },
    data: {
      resourceType: "Link",
      resourceId: link.id,
      resourceKey: resourceKey("Link", link.id),
      baseClassName: "graph-edge graph-edge--semantic",
      summary: link.summary,
    },
    className: "graph-edge graph-edge--semantic",
    labelShowBg: true,
    labelBgStyle: {
      fill: "rgba(240, 253, 250, 0.92)",
      fillOpacity: 1,
      stroke: "rgba(15, 118, 110, 0.18)",
    },
    labelStyle: {
      fill: "#0f766e",
      fontSize: 11,
      fontWeight: 600,
    },
    labelBgPadding: [10, 4],
    labelBgBorderRadius: 8,
  }));
}

function buildCapabilityEdges(bundle: DomainBundle): Edge<GraphEdgeData>[] {
  return bundle.capabilityGraph.edges
    .filter((edge) => edge.type !== "LINK")
    .filter((edge) => !edge.from.startsWith("Link:") && !edge.to.startsWith("Link:"))
    .filter((edge) => edge.from !== edge.to)
    .map((edge) => ({
      id: `capability:${edge.from}:${edge.type}:${edge.to}`,
      source: edge.from,
      target: edge.to,
      label: edge.type,
      type: "default",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: "rgba(29, 78, 216, 0.4)",
      },
      data: {
        resourceType: "Capability",
        resourceId: `${edge.type}:${edge.from}:${edge.to}`,
        resourceKey: `Capability:${edge.type}:${edge.from}:${edge.to}`,
        baseClassName: "graph-edge graph-edge--capability",
      },
      className: "graph-edge graph-edge--capability",
      labelShowBg: true,
      labelBgStyle: {
        fill: "rgba(239, 246, 255, 0.92)",
        fillOpacity: 1,
        stroke: "rgba(29, 78, 216, 0.14)",
      },
      labelStyle: {
        fill: "#1d4ed8",
        fontSize: 10,
        fontWeight: 600,
      },
      labelBgPadding: [8, 4],
      labelBgBorderRadius: 8,
    }));
}

function applySearchFilter(
  nodes: Array<{
    id: string;
    resourceType: GraphNodeType;
    resourceId: string;
    name: string;
    summary: string;
  }>,
  edges: Edge<GraphEdgeData>[],
  search: string,
) {
  const normalized = search.trim().toLowerCase();
  const visibleNodeIds = new Set(nodes.map((node) => node.id));

  if (!normalized) {
    return visibleNodeIds;
  }

  const matchedNodeIds = nodes
    .filter((node) => {
      const haystack = `${node.resourceId} ${node.name} ${node.summary}`.toLowerCase();
      return haystack.includes(normalized);
    })
    .map((node) => node.id);

  const matchedEdges = edges.filter((edge) => {
    const haystack = `${edge.id} ${edge.label || ""} ${edge.data?.summary || ""}`.toLowerCase();
    return haystack.includes(normalized);
  });

  const expanded = new Set<string>(matchedNodeIds);
  matchedEdges.forEach((edge) => {
    expanded.add(edge.source);
    expanded.add(edge.target);
  });

  edges.forEach((edge) => {
    if (expanded.has(edge.source) || expanded.has(edge.target)) {
      expanded.add(edge.source);
      expanded.add(edge.target);
    }
  });

  return expanded.size ? expanded : visibleNodeIds;
}

function layoutGraph(nodes: Node<GraphNodeData>[], edges: Edge<GraphEdgeData>[], mode: GraphMode) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: mode === "semantic" ? 72 : 84,
    nodesep: mode === "semantic" ? 32 : 40,
    edgesep: 12,
    marginx: 12,
    marginy: 12,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  return nodes.map((node) => {
    const positioned = graph.node(node.id);
    return {
      ...node,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      position: {
        x: (positioned?.x ?? NODE_WIDTH / 2) - NODE_WIDTH / 2,
        y: (positioned?.y ?? NODE_HEIGHT / 2) - NODE_HEIGHT / 2,
      },
    };
  });
}

function buildGraph(bundle: DomainBundle, mode: GraphMode, search: string) {
  const allNodes = buildNodeRecord(bundle);
  const semanticEdges = buildSemanticEdges(bundle);
  const capabilityEdges = buildCapabilityEdges(bundle);

  const baseNodes =
    mode === "semantic"
      ? allNodes.filter((node) => node.resourceType === "Object")
      : allNodes;

  const baseEdges =
    mode === "semantic"
      ? semanticEdges
      : mode === "capability"
        ? capabilityEdges
        : [...semanticEdges, ...capabilityEdges];

  const visibleNodeIds = applySearchFilter(baseNodes, baseEdges, search);

  const filteredNodes = baseNodes.filter((node) => visibleNodeIds.has(node.id));
  const filteredNodeIdSet = new Set(filteredNodes.map((node) => node.id));

  const filteredEdges = baseEdges.filter(
    (edge) => filteredNodeIdSet.has(edge.source) && filteredNodeIdSet.has(edge.target),
  );

  const nodes: Node<GraphNodeData>[] = filteredNodes.map((node) => ({
    id: node.id,
    type: "resource",
    position: { x: 0, y: 0 },
    draggable: true,
    data: {
      resourceType: node.resourceType,
      resourceId: node.resourceId,
      resourceKey: node.id,
      name: node.name,
      summary: node.summary,
      selected: false,
    },
  }));

  return {
    nodes: layoutGraph(nodes, filteredEdges, mode),
    edges: filteredEdges,
  };
}

function withSelection(
  nodes: Node<GraphNodeData>[],
  edges: Edge<GraphEdgeData>[],
  selectedKey: string,
) {
  return {
    nodes: nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        selected: node.data.resourceKey === selectedKey,
      },
    })),
    edges: edges.map((edge) => ({
      ...edge,
      className:
        edge.data?.resourceKey === selectedKey
          ? `${edge.data.baseClassName} is-selected`
          : edge.data?.baseClassName || edge.className,
    })),
  };
}

export function ResourceGraph({
  bundle,
  mode,
  search,
  selectedKey,
  onSelect,
}: {
  bundle: DomainBundle;
  mode: GraphMode;
  search: string;
  selectedKey: string;
  onSelect: (resourceType: ResourceType | "Link", resourceId: string) => void;
}) {
  const deferredSearch = useDeferredValue(search);
  const graph = useMemo(() => buildGraph(bundle, mode, deferredSearch), [bundle, mode, deferredSearch]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<GraphNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<GraphEdgeData>>([]);

  useEffect(() => {
    const next = withSelection(graph.nodes, graph.edges, selectedKey);
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [graph, setEdges, setNodes]);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          selected: node.data.resourceKey === selectedKey,
        },
      })),
    );
    setEdges((current) =>
      current.map((edge) => ({
        ...edge,
        className:
          edge.data?.resourceKey === selectedKey
            ? `${edge.data.baseClassName} is-selected`
            : edge.data?.baseClassName || edge.className,
      })),
    );
  }, [selectedKey, setEdges, setNodes]);

  return (
    <div className="graph-stage">
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
        minZoom={0.25}
        maxZoom={1.6}
        fitViewOptions={{ padding: 0.03, duration: 480, minZoom: 0.62, maxZoom: 1.08 }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_event, node) => onSelect(node.data.resourceType, node.data.resourceId)}
        onEdgeClick={(_event, edge) => {
          if (edge.data?.resourceType === "Link") {
            onSelect("Link", edge.data.resourceId);
          }
        }}
      >
        <MiniMap pannable zoomable nodeStrokeWidth={3} />
        <Controls showInteractive={false} />
        <Background gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}
