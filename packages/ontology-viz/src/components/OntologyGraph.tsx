/**
 * @ontology/viz — OntologyGraph component
 *
 * Main interactive graph visualization for OWL ontology.
 * Renders classes as nodes, object properties as edges.
 * Supports click-to-inspect, domain-coloured nodes,
 * provenance-level visual distinction, and multiple
 * layout algorithms (dagre tree / force-directed).
 *
 * Built on @xyflow/react (React Flow v12).
 */

import dagre from "@dagrejs/dagre";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from "d3-force";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type CSSProperties,
} from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  Position,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {
  OntologyGraphData,
  GraphNodeData,
  GraphEdgeData,
  DomainColorScheme,
  GraphFilters,
  LayoutMode,
} from "../lib/types";
import {
  DEFAULT_COLOR_SCHEME,
  domainKeyFromIRI,
} from "../lib/colors";

// ─── Constants ──────────────────────────────────────────────────

const NODE_WIDTH = 280;
const NODE_HEIGHT = 110;

// ─── Custom Node ────────────────────────────────────────────────

function OntologyNode({ data }: NodeProps<Node<GraphNodeData>>) {
  const { entity, provenanceLevel, domainKey, selected } = data;
  const scheme = DEFAULT_COLOR_SCHEME;
  const domainColor = domainKey
    ? scheme.domainColors[domainKey] ?? scheme.defaultNodeColor
    : scheme.defaultNodeColor;
  const provenanceColor = scheme.provenanceColors[provenanceLevel];

  // Convert hex domainColor to rgba for safe cross-browser tinting
  const hexToRgba = (hex: string, alpha: number): string => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const cardStyle: CSSProperties = {
    borderLeft: `4px solid ${domainColor}`,
    background: domainKey
      ? `linear-gradient(135deg, ${hexToRgba(domainColor, 0.12)} 0%, ${hexToRgba(domainColor, 0.04)} 100%)`
      : "#fff",
    boxShadow: selected
      ? `0 0 0 2px ${provenanceColor}, 0 4px 12px rgba(0,0,0,0.1)`
      : "0 1px 3px rgba(0,0,0,0.08)",
  };

  const isIndividual = entity.kind === "individual";

  return (
    <div
      className={`ontology-node ${isIndividual ? "ontology-node--individual" : ""} ${selected ? "is-selected" : ""}`}
      style={cardStyle}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />

      <div className="ontology-node__header">
        <span
          className="ontology-node__badge"
          style={{ backgroundColor: domainColor }}
        >
          {isIndividual ? "RP" : "C"}
        </span>
        {entity.abbreviation && (
          <span className="ontology-node__abbrev">{entity.abbreviation}</span>
        )}
        <span
          className="ontology-node__level"
          style={{
            color: provenanceColor,
            borderColor: provenanceColor,
          }}
        >
          {provenanceLevel}
        </span>
      </div>

      <div className="ontology-node__label">
        {entity.labelZh ?? entity.label}
      </div>

      {entity.comment && (
        <div className="ontology-node__comment">
          {entity.comment.slice(0, 80)}{entity.comment.length > 80 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  ontologyClass: OntologyNode,
};

// ─── Graph builders ─────────────────────────────────────────────

function buildNodes(
  data: OntologyGraphData,
  selectedIRI: string,
  filters: GraphFilters,
): Node<GraphNodeData>[] {
  const nodes: Node<GraphNodeData>[] = [];

  for (const cls of data.classes) {
    const domainKey = domainKeyFromIRI(cls.domainIRI);
    const domainOk = filters.domains.length === 0 || (domainKey && filters.domains.includes(domainKey));
    const genOk = filters.generations.length === 0 || (cls.generation && filters.generations.includes(cls.generation));
    const provOk = filters.provenanceLevels.length === 0 || filters.provenanceLevels.includes(cls.provenance.level);
    if (!domainOk || !genOk || !provOk) continue;

    const search = filters.search.toLowerCase();
    if (search) {
      const haystack = `${cls.localName} ${cls.label} ${cls.labelZh ?? ""} ${cls.abbreviation ?? ""} ${cls.comment ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) continue;
    }

    nodes.push({
      id: cls.iri,
      type: "ontologyClass",
      position: { x: 0, y: 0 },
      draggable: true,
      data: {
        entity: cls,
        provenanceLevel: cls.provenance.level,
        domainKey,
        selected: cls.iri === selectedIRI,
      },
    });
  }

  for (const ind of data.individuals) {
    const search = filters.search.toLowerCase();
    if (search) {
      const haystack = `${ind.localName} ${ind.label} ${ind.labelZh ?? ""} ${ind.comment ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) continue;
    }

    nodes.push({
      id: ind.iri,
      type: "ontologyClass",
      position: { x: 0, y: 0 },
      draggable: true,
      data: {
        entity: ind,
        provenanceLevel: ind.provenance.level,
        domainKey: undefined,
        selected: ind.iri === selectedIRI,
      },
    });
  }

  return nodes;
}

function buildEdges(
  data: OntologyGraphData,
  filters: GraphFilters,
): Edge<GraphEdgeData>[] {
  const edges: Edge<GraphEdgeData>[] = [];

  for (const prop of data.objectProperties) {
    const source = prop.domainIRI;
    const target = prop.rangeIRI;
    if (!source || !target) continue;

    const sourceExists = data.classes.some((c) => c.iri === source) ||
      data.individuals.some((i) => i.iri === source);
    const targetExists = data.classes.some((c) => c.iri === target) ||
      data.individuals.some((i) => i.iri === target);
    if (!sourceExists || !targetExists) continue;

    const label = prop.labelZh ?? prop.label;

    edges.push({
      id: `${prop.iri}#${source}->${target}`,
      source,
      target,
      label,
      type: "default",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: prop.direction === "userPlane"
          ? "#22c55e"
          : prop.direction === "controlPlane"
            ? "#3b82f6"
            : "#9ca3af",
      },
      data: {
        property: prop,
        isSubClassOf: false,
        provenanceLevel: prop.provenance.level,
      },
      style: {
        stroke: prop.direction === "userPlane"
          ? "#22c55e"
          : prop.direction === "controlPlane"
            ? "#3b82f6"
            : "#9ca3af",
        strokeWidth: prop.transitive ? 2 : 1,
        strokeDasharray: prop.symmetric ? "5,5" : "none",
      },
      labelShowBg: true,
      labelBgStyle: { fill: "rgba(255,255,255,0.9)", fillOpacity: 1 },
      labelStyle: { fontSize: 10, fontWeight: 500 },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 6,
    });
  }

  return edges;
}

// ─── Layout algorithms ──────────────────────────────────────────

/**
 * Dagre layout — left-to-right Sugiyama-style layered graph.
 * Best for showing hierarchical topology (subClassOf, domain→range chains).
 */
function layoutDagre(
  nodes: Node<GraphNodeData>[],
  edges: Edge<GraphEdgeData>[],
): Node<GraphNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    ranksep: 60,
    nodesep: 28,
    edgesep: 10,
    marginx: 10,
    marginy: 10,
  });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const positioned = g.node(node.id);
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

/**
 * d3-force layout — force-directed graph.
 * Best for exploring connectivity clusters and seeing
 * which entities have the most relationships.
 */
function layoutForce(
  nodes: Node<GraphNodeData>[],
  edges: Edge<GraphEdgeData>[],
): Node<GraphNodeData>[] {
  if (nodes.length === 0) return nodes;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const simNodes = nodes.map((n) => ({ id: n.id, x: 0, y: 0 }));
  const simLinks = edges
    .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  if (simLinks.length === 0) {
    // No edges — place nodes in a grid
    const cols = Math.ceil(Math.sqrt(nodes.length));
    return nodes.map((node, i) => ({
      ...node,
      sourcePosition: Position.Right as const,
      targetPosition: Position.Left as const,
      position: {
        x: (i % cols) * (NODE_WIDTH + 40),
        y: Math.floor(i / cols) * (NODE_HEIGHT + 30),
      },
    }));
  }

  const sim = forceSimulation(simNodes)
    .force(
      "link",
      forceLink(simLinks)
        .id((d: any) => d.id)
        .distance(200),
    )
    .force("charge", forceManyBody().strength(-800))
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide(NODE_WIDTH / 1.5))
    .stop();

  // Run simulation synchronously
  for (let i = 0; i < 300; i++) sim.tick();

  return nodes.map((node) => {
    const simNode = simNodes.find((sn) => sn.id === node.id);
    return {
      ...node,
      sourcePosition: Position.Right as const,
      targetPosition: Position.Left as const,
      position: simNode
        ? { x: simNode.x, y: simNode.y }
        : node.position,
    };
  });
}

// ─── Component ──────────────────────────────────────────────────

export interface OntologyGraphProps {
  data: OntologyGraphData;
  /** IRI of the currently selected entity */
  selectedIRI: string;
  /** Active filters */
  filters: GraphFilters;
  /** Layout algorithm (default: "dagre") */
  layoutMode?: LayoutMode;
  /** Optional colour scheme override */
  colorScheme?: DomainColorScheme;
  /** Called when user clicks a node or edge */
  onSelect: (iri: string) => void;
}

export function OntologyGraph(props: OntologyGraphProps) {
  return (
    <ReactFlowProvider>
      <OntologyGraphInner {...props} />
    </ReactFlowProvider>
  );
}

function OntologyGraphInner({
  data,
  selectedIRI,
  filters,
  layoutMode = "dagre",
  onSelect,
}: OntologyGraphProps) {
  const { fitView } = useReactFlow();
  const deferredSearch = useDeferredValue(filters.search);
  const effectiveFilters = useMemo(
    () => ({ ...filters, search: deferredSearch }),
    [filters, deferredSearch],
  );

  // Compute nodes/edges with layout (NOT dependent on selectedIRI)
  const { nodes: rawNodes, edges: rawEdges } = useMemo(() => {
    const n = buildNodes(data, "", effectiveFilters);  // "" = no selection
    const e = buildEdges(data, effectiveFilters);
    const laidOut = layoutMode === "force"
      ? layoutForce(n, e)
      : layoutDagre(n, e);
    return { nodes: laidOut, edges: e };
  }, [data, effectiveFilters, layoutMode]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<GraphNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<GraphEdgeData>>([]);

  // Initial load & layout change: set nodes + fit view
  const prevLayout = useRef(layoutMode);
  useEffect(() => {
    setNodes(rawNodes);
    setEdges(rawEdges);
    // Fit viewport on initial load or layout switch
    const timer = setTimeout(() => {
      fitView({ padding: 0.04, duration: 300, minZoom: 0.4, maxZoom: 1.0 });
    }, 100);
    prevLayout.current = layoutMode;
    return () => clearTimeout(timer);
  }, [rawNodes, rawEdges, setNodes, setEdges, fitView, layoutMode]);

  // Update selection highlight separately (does NOT trigger fitView)
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: { ...node.data, selected: node.data.entity.iri === selectedIRI },
      })),
    );
  }, [selectedIRI, setNodes]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<GraphNodeData>) => {
      onSelect(node.data.entity.iri);
    },
    [onSelect],
  );

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge<GraphEdgeData>) => {
      if (edge.data?.property) {
        onSelect(edge.data.property.iri);
      }
    },
    [onSelect],
  );

  return (
    <div className="ontology-graph">
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
        minZoom={0.15}
        maxZoom={1.6}
        fitViewOptions={{ padding: 0.04, duration: 480, minZoom: 0.4, maxZoom: 1.0 }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
      >
        <MiniMap pannable zoomable nodeStrokeWidth={3} />
        <Controls showInteractive={false} />
        <Background gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}
