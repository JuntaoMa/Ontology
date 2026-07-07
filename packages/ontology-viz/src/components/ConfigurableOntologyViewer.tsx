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
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  getExplicitOntologyDefaultDescription,
  getExplicitOntologyDefaultLabel,
  getExplicitOntologyDisplayValue,
  getExplicitOntologyFieldValues,
} from "../lib/explicitOntologyParser";
import type {
  ExplicitOntologyEdge,
  ExplicitOntologyEdgeKind,
  ExplicitOntologyEntity,
  ExplicitOntologyEntityKind,
  ExplicitOntologyField,
  ExplicitOntologyGraphData,
  ExplicitOntologyLayoutMode,
  ExplicitOntologyVisualConfig,
} from "../lib/explicitOntologyTypes";

const NODE_WIDTH = 280;
const NODE_HEIGHT = 116;
const CONFIG_STORAGE_PREFIX = "ontology-viz:explicit-config:";

const ENTITY_KIND_LABELS: Record<ExplicitOntologyEntityKind, string> = {
  Class: "Class",
  ObjectProperty: "ObjectProperty",
  DatatypeProperty: "DatatypeProperty",
  AnnotationProperty: "AnnotationProperty",
};

const EDGE_KIND_LABELS: Record<ExplicitOntologyEdgeKind, string> = {
  subClassOf: "subClassOf",
  objectRelation: "ObjectProperty",
  domain: "domain",
  range: "range",
  subPropertyOf: "subPropertyOf",
};

const LAYOUT_LABELS: Record<ExplicitOntologyLayoutMode, string> = {
  layered: "Dagre",
  force: "D3 Force",
};

const FIELD_PALETTE = [
  "#2563eb",
  "#0f766e",
  "#7c3aed",
  "#c2410c",
  "#be123c",
  "#0369a1",
  "#4d7c0f",
  "#9333ea",
];

export const DEFAULT_EXPLICIT_ONTOLOGY_CONFIG: ExplicitOntologyVisualConfig = {
  visibleEntityKinds: ["Class"],
  layoutMode: "force",
  card: {
    titleField: "localName",
    subtitleField: "rdf:type",
    descriptionField: "http://www.w3.org/2000/01/rdf-schema#comment",
    badgeFields: ["namespace"],
  },
  color: {
    mode: "type",
    typeColors: {
      Class: "#2563eb",
      ObjectProperty: "#7c3aed",
      DatatypeProperty: "#0f766e",
      AnnotationProperty: "#64748b",
    },
  },
  edges: {
    showLabels: true,
    showArrows: true,
    colorByKind: {
      subClassOf: "#64748b",
      objectRelation: "#7c3aed",
      domain: "#0f766e",
      range: "#2563eb",
      subPropertyOf: "#a16207",
    },
  },
};

function createExplicitOntologyConfig(...configs: Array<Partial<ExplicitOntologyVisualConfig> | undefined>) {
  return configs.reduce<ExplicitOntologyVisualConfig>((merged, config) => ({
    ...merged,
    ...config,
    card: {
      ...merged.card,
      ...config?.card,
    },
    color: {
      ...merged.color,
      ...config?.color,
      typeColors: {
        ...merged.color.typeColors,
        ...config?.color?.typeColors,
      },
    },
    edges: {
      ...merged.edges,
      ...config?.edges,
      colorByKind: {
        ...merged.edges.colorByKind,
        ...config?.edges?.colorByKind,
      },
    },
  }), {
    ...DEFAULT_EXPLICIT_ONTOLOGY_CONFIG,
    card: {
      ...DEFAULT_EXPLICIT_ONTOLOGY_CONFIG.card,
    },
    color: {
      ...DEFAULT_EXPLICIT_ONTOLOGY_CONFIG.color,
      typeColors: {
        ...DEFAULT_EXPLICIT_ONTOLOGY_CONFIG.color.typeColors,
      },
    },
    edges: {
      ...DEFAULT_EXPLICIT_ONTOLOGY_CONFIG.edges,
      colorByKind: {
        ...DEFAULT_EXPLICIT_ONTOLOGY_CONFIG.edges.colorByKind,
      },
    },
  });
}

function configStorageKey(data: ExplicitOntologyGraphData, storageKey?: string) {
  const identity = storageKey || data.ontologyIRI || data.ontologyTitle || "anonymous";
  return `${CONFIG_STORAGE_PREFIX}${identity}`;
}

function readSavedConfig(storageKey: string) {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { config?: Partial<ExplicitOntologyVisualConfig> };
    return parsed.config;
  } catch {
    return undefined;
  }
}

function writeSavedConfig(storageKey: string, config: ExplicitOntologyVisualConfig) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      config,
    }));
    return true;
  } catch {
    return false;
  }
}

interface ExplicitNodeData extends Record<string, unknown> {
  entity: ExplicitOntologyEntity;
  config: ExplicitOntologyVisualConfig;
  fields: ExplicitOntologyField[];
  selected: boolean;
  highlighted: boolean;
  color: string;
}

interface ExplicitEdgeData extends Record<string, unknown> {
  edge: ExplicitOntologyEdge;
  selected?: boolean;
  highlighted?: boolean;
}

function tint(hex: string, alpha: number) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return `rgba(100,116,139,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function fieldLabel(fields: ExplicitOntologyField[], fieldId: string) {
  return fields.find((field) => field.id === fieldId)?.label ?? fieldId;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function colorForEntity(entity: ExplicitOntologyEntity, config: ExplicitOntologyVisualConfig) {
  if (config.color.mode === "field" && config.color.field) {
    const value = getExplicitOntologyDisplayValue(entity, config.color.field);
    if (value) return FIELD_PALETTE[hashString(value) % FIELD_PALETTE.length];
  }
  return config.color.typeColors[entity.kind];
}

function compactLabel(entity: ExplicitOntologyEntity): string {
  const acronym = entity.localName.replace(/[^A-Z0-9]/g, "");
  if (acronym.length >= 2) return acronym.slice(0, 5);
  return entity.localName.slice(0, 4);
}

const ExplicitOntologyNode = memo(function ExplicitOntologyNode({
  data,
}: NodeProps<Node<ExplicitNodeData>>) {
  const { entity, color } = data;
  const isSelected = data.selected;
  const label = compactLabel(entity);

  return (
    <div
      className={[
        "explicit-ontology-node",
        data.selected ? "is-selected" : "",
        data.highlighted ? "is-highlighted" : "",
      ].filter(Boolean).join(" ")}
      style={{
        width: 36,
        height: 36,
        borderRadius: "50%",
        background: color,
        boxShadow: isSelected
          ? `0 0 0 3px ${tint(color, 0.42)}, 0 0 0 5px ${tint(color, 0.22)}`
          : "0 1px 4px rgba(15,23,42,0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 700,
        color: "#fff",
        cursor: "pointer",
        letterSpacing: "-0.2px",
      }}
    >
      {label}
      <Handle
        id="center-target"
        className="explicit-ontology-node__center-handle"
        type="target"
        position={Position.Top}
        style={{ background: "transparent", border: "none", width: 0, height: 0 }}
      />
      <Handle
        id="center-source"
        className="explicit-ontology-node__center-handle"
        type="source"
        position={Position.Top}
        style={{ background: "transparent", border: "none", width: 0, height: 0 }}
      />
    </div>
  );
});

const nodeTypes = {
  explicitOntology: ExplicitOntologyNode,
};

function matchesSearch(entity: ExplicitOntologyEntity, search: string) {
  if (!search) return true;
  const haystack = [
    entity.iri,
    entity.localName,
    entity.namespace,
    entity.kind,
    ...Object.values(entity.literalProperties).flatMap((values) => values.map((item) => item.value)),
  ].join(" ").toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function visibleEntityIds(
  data: ExplicitOntologyGraphData,
  config: ExplicitOntologyVisualConfig,
  search: string,
) {
  const visibleKinds = new Set(config.visibleEntityKinds);
  return new Set(
    data.entities
      .filter((entity) => visibleKinds.has(entity.kind))
      .filter((entity) => matchesSearch(entity, search))
      .map((entity) => entity.id),
  );
}

function edgeVisibleForNodes(edge: ExplicitOntologyEdge, visibleIds: Set<string>) {
  return visibleIds.has(edge.source) && visibleIds.has(edge.target);
}

function buildNodes(
  data: ExplicitOntologyGraphData,
  config: ExplicitOntologyVisualConfig,
  selectedId: string,
  search: string,
): Node<ExplicitNodeData>[] {
  const ids = visibleEntityIds(data, config, search);
  return data.entities
    .filter((entity) => ids.has(entity.id))
    .map((entity) => {
      const color = colorForEntity(entity, config);
      return {
        id: entity.id,
        type: "explicitOntology",
        position: { x: 0, y: 0 },
        draggable: true,
        data: {
          entity,
          config,
          fields: data.fields,
          selected: entity.id === selectedId,
          highlighted: false,
          color,
        },
      };
    });
}

function buildEdges(
  data: ExplicitOntologyGraphData,
  config: ExplicitOntologyVisualConfig,
  visibleIds: Set<string>,
): Edge<ExplicitEdgeData>[] {
  return data.edges
    .filter((edge) => edgeVisibleForNodes(edge, visibleIds))
    .map((edge) => {
      const color = config.edges.colorByKind[edge.kind];
      return {
        id: edge.id,
        type: "straight",
        source: edge.source,
        sourceHandle: "center-source",
        target: edge.target,
        targetHandle: "center-target",
        label: config.edges.showLabels ? edge.label : undefined,
        markerEnd: config.edges.showArrows
          ? {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color,
            }
          : undefined,
        data: { edge },
        style: {
          stroke: color,
          strokeWidth: edge.kind === "objectRelation" ? 1.8 : 1.2,
          strokeDasharray: edge.kind === "subClassOf" ? "5 4" : "none",
        },
        labelShowBg: config.edges.showLabels,
        labelBgStyle: { fill: "rgba(255,255,255,0.9)", fillOpacity: 1 },
        labelStyle: { fontSize: 10, fontWeight: 600, fill: "#334155" },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
      };
    });
}

function layoutLayered(nodes: Node<ExplicitNodeData>[], edges: Edge<ExplicitEdgeData>[]) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", ranksep: 72, nodesep: 34, edgesep: 12, marginx: 18, marginy: 18 });
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

function layoutForce(nodes: Node<ExplicitNodeData>[], edges: Edge<ExplicitEdgeData>[]) {
  if (nodes.length === 0) return nodes;
  const spread = Math.sqrt(nodes.length) * 80;
  const simNodes = nodes.map((node) => ({
    id: node.id,
    x: (Math.random() - 0.5) * spread * 2,
    y: (Math.random() - 0.5) * spread * 2,
  }));
  const ids = new Set(nodes.map((node) => node.id));
  const links = edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));

  const sim = forceSimulation(simNodes)
    .force("link", forceLink(links).id((item: any) => item.id).distance(80).strength(0.6))
    .force("charge", forceManyBody().strength(-200).distanceMax(800))
    .force("center", forceCenter(0, 0))
    .force("x", forceX(0).strength(0.02))
    .force("y", forceY(0).strength(0.02))
    .force("collide", forceCollide(14).strength(0.8).iterations(2))
    .stop();
  for (let index = 0; index < 300; index += 1) sim.tick();
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const simNode = byId.get(node.id);
    return {
      ...node,
      position: simNode ? { x: simNode.x, y: simNode.y } : node.position,
    };
  });
}

function applyLayout(
  nodes: Node<ExplicitNodeData>[],
  edges: Edge<ExplicitEdgeData>[],
  mode: ExplicitOntologyLayoutMode,
) {
  if (mode === "force") return layoutForce(nodes, edges);
  return layoutLayered(nodes, edges);
}

function selectionSets(selectedId: string, nodes: Node<ExplicitNodeData>[], edges: Edge<ExplicitEdgeData>[]) {
  const highlightedNodes = new Set<string>();
  const highlightedEdges = new Set<string>();
  const selectedNodeId = nodes.some((node) => node.id === selectedId) ? selectedId : "";
  const selectedEdgeId = edges.some((edge) => edge.id === selectedId) ? selectedId : "";
  if (selectedNodeId) {
    highlightedNodes.add(selectedNodeId);
    for (const edge of edges) {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        highlightedEdges.add(edge.id);
        highlightedNodes.add(edge.source);
        highlightedNodes.add(edge.target);
      }
    }
  } else if (selectedEdgeId) {
    const edge = edges.find((item) => item.id === selectedEdgeId);
    if (edge) {
      highlightedEdges.add(edge.id);
      highlightedNodes.add(edge.source);
      highlightedNodes.add(edge.target);
    }
  }
  return { selectedNodeId, selectedEdgeId, highlightedNodes, highlightedEdges };
}

function ConfigurableOntologyGraph({
  data,
  config,
  selectedId,
  search,
  onSelect,
  onClearSelection,
  onSearchChange,
  onLayoutChange,
  onSettingsOpen,
}: {
  data: ExplicitOntologyGraphData;
  config: ExplicitOntologyVisualConfig;
  selectedId: string;
  search: string;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  onSearchChange: (value: string) => void;
  onLayoutChange: (mode: ExplicitOntologyLayoutMode) => void;
  onSettingsOpen: () => void;
}) {
  const { fitView, zoomIn, zoomOut, setViewport } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const deferredSearch = useDeferredValue(search);
  const { rawNodes, rawEdges } = useMemo(() => {
    const nodes = buildNodes(data, config, "", deferredSearch.trim());
    const visibleIds = new Set(nodes.map((node) => node.id));
    const edges = buildEdges(data, config, visibleIds);
    return { rawNodes: applyLayout(nodes, edges, config.layoutMode), rawEdges: edges };
  }, [config, data, deferredSearch]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ExplicitNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<ExplicitEdgeData>>([]);
  const hasSelection = Boolean(selectedId) &&
    (rawNodes.some((node) => node.id === selectedId) || rawEdges.some((edge) => edge.id === selectedId));

  useEffect(() => {
    setNodes(rawNodes);
    setEdges(rawEdges);
    const timer = window.setTimeout(() => {
      fitView({ padding: 0.08, duration: rawNodes.length > 180 ? 0 : 260, minZoom: 0.04, maxZoom: 1 });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [fitView, rawEdges, rawNodes, setEdges, setNodes]);

  useEffect(() => {
    const sets = selectionSets(selectedId, rawNodes, rawEdges);
    setNodes((current) =>
      current.map((node) => {
        const selected = node.id === sets.selectedNodeId;
        const highlighted = sets.highlightedNodes.has(node.id);
        if (node.data.selected === selected && node.data.highlighted === highlighted) return node;
        return { ...node, data: { ...node.data, selected, highlighted } };
      }),
    );
    setEdges((current) =>
      current.map((edge) => {
        const selected = edge.id === sets.selectedEdgeId;
        const highlighted = sets.highlightedEdges.has(edge.id);
        if (edge.data?.selected === selected && edge.data?.highlighted === highlighted) return edge;
        const graphEdge = edge.data?.edge;
        if (!graphEdge) return edge;
        const color = config.edges.colorByKind[graphEdge.kind];
        return {
          ...edge,
          className: [selected ? "is-selected" : "", highlighted ? "is-highlighted" : ""].filter(Boolean).join(" "),
          style: {
            ...(edge.style ?? {}),
            stroke: color,
            strokeWidth: selected ? 3 : highlighted ? 2.4 : graphEdge.kind === "objectRelation" ? 1.8 : 1.2,
          },
          data: { ...(edge.data ?? {}), edge: graphEdge, selected, highlighted },
        };
      }),
    );
  }, [config.edges.colorByKind, rawEdges, rawNodes, selectedId, setEdges, setNodes]);

  const nodeColor = useCallback((node: Node<ExplicitNodeData>) => node.data.color, []);

  return (
    <div className={`explicit-ontology-graph ${hasSelection ? "has-selection" : ""}`}>
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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onEdgeClick={(_event, edge) => onSelect(edge.id)}
        onPaneClick={onClearSelection}
      >
        {nodes.length <= 500 && <MiniMap pannable zoomable nodeColor={nodeColor} nodeStrokeWidth={3} />}
        <Background gap={20} size={1} />
        <div className="explicit-canvas-toolbar">
          <div className="explicit-canvas-toolbar__search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              placeholder="搜索实体..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <div className="explicit-canvas-toolbar__sep" />
          <select
            className="explicit-canvas-toolbar__layout"
            value={config.layoutMode}
            onChange={(e) => onLayoutChange(e.target.value as ExplicitOntologyLayoutMode)}
          >
            {(Object.keys(LAYOUT_LABELS) as ExplicitOntologyLayoutMode[]).map((m) => (
              <option value={m} key={m}>{LAYOUT_LABELS[m]}</option>
            ))}
          </select>
          <div className="explicit-canvas-toolbar__sep" />
          <div className="explicit-canvas-toolbar__zoom">
            <button title="适应画布" onClick={() => fitView({ padding: 0.08, duration: 260 })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
            </button>
            <button title="缩小" onClick={() => zoomOut({ duration: 200 })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            </button>
            <span className="explicit-canvas-toolbar__zoom-label">{Math.round(zoom * 100)}%</span>
            <button title="放大" onClick={() => zoomIn({ duration: 200 })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            </button>
            <button title="1:1" onClick={() => setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 200 })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8v8M12 8v8M17 8v8"/></svg>
            </button>
          </div>
          <div className="explicit-canvas-toolbar__sep" />
          <button className="explicit-canvas-toolbar__settings" title="设置" onClick={onSettingsOpen}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
      </ReactFlow>
    </div>
  );
}

function FieldSelect({
  label,
  value,
  fields,
  onChange,
  allowNone = false,
}: {
  label: string;
  value: string;
  fields: ExplicitOntologyField[];
  onChange: (value: string) => void;
  allowNone?: boolean;
}) {
  return (
    <label className="explicit-config-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {allowNone && <option value="">不显示</option>}
        {fields.map((field) => (
          <option value={field.id} key={field.id}>
            {field.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SettingsModal({
  data,
  config,
  search,
  onSearchChange,
  onConfigChange,
  onSave,
  onClose,
}: {
  data: ExplicitOntologyGraphData;
  config: ExplicitOntologyVisualConfig;
  search: string;
  onSearchChange: (value: string) => void;
  onConfigChange: (config: ExplicitOntologyVisualConfig) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const update = (patch: Partial<ExplicitOntologyVisualConfig>) => onConfigChange({ ...config, ...patch });
  const updateCard = (patch: Partial<ExplicitOntologyVisualConfig["card"]>) =>
    update({ card: { ...config.card, ...patch } });
  const updateEdges = (patch: Partial<ExplicitOntologyVisualConfig["edges"]>) =>
    update({ edges: { ...config.edges, ...patch } });
  const updateColor = (patch: Partial<ExplicitOntologyVisualConfig["color"]>) =>
    update({ color: { ...config.color, ...patch } });

  const toggleType = (kind: ExplicitOntologyEntityKind) => {
    const next = config.visibleEntityKinds.includes(kind)
      ? config.visibleEntityKinds.filter((item) => item !== kind)
      : [...config.visibleEntityKinds, kind];
    update({ visibleEntityKinds: next.length > 0 ? next : [kind] });
  };

  const toggleBadge = (fieldId: string) => {
    const next = config.card.badgeFields.includes(fieldId)
      ? config.card.badgeFields.filter((item) => item !== fieldId)
      : [...config.card.badgeFields, fieldId].slice(0, 4);
    updateCard({ badgeFields: next });
  };

  return (
    <div className="explicit-modal-inner">
      <div className="explicit-modal-header">
        <h2>可视化设置</h2>
        <button className="explicit-modal-close" type="button" onClick={onClose}>✕</button>
      </div>
      <div className="explicit-modal-body">
        <section className="explicit-config-section">
          <h3>检索</h3>
          <label className="explicit-config-field">
            <input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="关键词..." />
          </label>
        </section>
        <section className="explicit-config-section">
          <h3>实体类型</h3>
          <div className="explicit-config-checks">
            {(Object.keys(ENTITY_KIND_LABELS) as ExplicitOntologyEntityKind[]).map((kind) => (
              <label key={kind}>
                <input type="checkbox" checked={config.visibleEntityKinds.includes(kind)} onChange={() => toggleType(kind)} />
                <span>{ENTITY_KIND_LABELS[kind]}</span>
                <small>{data.stats[kind]}</small>
              </label>
            ))}
          </div>
        </section>
        <section className="explicit-config-section">
          <h3>卡片字段</h3>
          <FieldSelect label="标题" value={config.card.titleField} fields={data.fields} onChange={(value) => updateCard({ titleField: value })} />
          <FieldSelect label="副标题" value={config.card.subtitleField} fields={data.fields} onChange={(value) => updateCard({ subtitleField: value })} allowNone />
          <FieldSelect label="描述" value={config.card.descriptionField} fields={data.fields} onChange={(value) => updateCard({ descriptionField: value })} allowNone />
          <div className="explicit-config-subsection">
            <span>Badges</span>
            <div className="explicit-config-badges">
              {data.fields.slice(0, 28).map((field) => (
                <button type="button" className={config.card.badgeFields.includes(field.id) ? "is-active" : ""} onClick={() => toggleBadge(field.id)} key={field.id}>
                  {field.label}
                </button>
              ))}
          </div>
          </div>
        </section>
        <section className="explicit-config-section">
          <h3>颜色</h3>
          <label className="explicit-config-field">
            <span>着色方式</span>
            <select value={config.color.mode} onChange={(event) => updateColor({ mode: event.target.value as any })}>
              <option value="type">按类型</option>
              <option value="field">按字段</option>
            </select>
          </label>
          {config.color.mode === "field" && (
            <FieldSelect label="颜色字段" value={config.color.field ?? "namespace"} fields={data.fields} onChange={(value) => updateColor({ field: value })} />
          )}
        </section>
        <section className="explicit-config-section">
          <h3>边</h3>
          <label className="explicit-config-switch">
            <input type="checkbox" checked={config.edges.showLabels} onChange={(evt) => updateEdges({ showLabels: evt.target.checked })} />
            <span>显示边标签</span>
          </label>
          <label className="explicit-config-switch">
            <input type="checkbox" checked={config.edges.showArrows} onChange={(evt) => updateEdges({ showArrows: evt.target.checked })} />
            <span>显示箭头</span>
          </label>
        </section>
      </div>
      <div className="explicit-modal-footer">
        <button className="explicit-modal-btn" type="button" onClick={() => {
          const defaults = { ...DEFAULT_EXPLICIT_ONTOLOGY_CONFIG };
          onConfigChange(defaults);
        }}>重置默认</button>
        <div style={{ flex: 1 }} />
        <button className="explicit-modal-btn" type="button" onClick={onClose}>取消</button>
        <button className="explicit-modal-btn is-primary" type="button" onClick={() => { onSave(); onClose(); }}>应用</button>
      </div>
    </div>
  );
}

function DetailPanel({
  data,
  selectedId,
  onClose,
}: {
  data: ExplicitOntologyGraphData;
  selectedId: string;
  onClose: () => void;
}) {
  const entity = data.entities.find((item) => item.id === selectedId);
  const edge = data.edges.find((item) => item.id === selectedId);
  if (!entity && !edge) return null;

  return (
    <aside className="explicit-detail-panel" aria-label="实体详情">
      <button className="explicit-detail-panel__close" onClick={onClose} aria-label="关闭详情">×</button>
      {entity ? (
        <>
          <header className="explicit-detail-panel__header">
            <span>{ENTITY_KIND_LABELS[entity.kind]}</span>
            <h2>{getExplicitOntologyDefaultLabel(entity)}</h2>
            <p>{entity.iri}</p>
          </header>
          <section>
            <h3>文字字段</h3>
            <dl>
              {Object.entries(entity.literalProperties).slice(0, 40).map(([predicate, values]) => (
                <div key={predicate}>
                  <dt>{compactPanelLabel(data.fields, predicate)}</dt>
                  <dd>{values.slice(0, 5).map((value) => value.value).join(" · ")}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>IRI 关系</h3>
            <dl>
              {Object.entries(entity.iriProperties).slice(0, 40).map(([predicate, values]) => (
                <div key={predicate}>
                  <dt>{compactPanelLabel(data.fields, predicate)}</dt>
                  <dd>{values.slice(0, 5).map((value) => value.value).join(" · ")}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      ) : (
        <>
          <header className="explicit-detail-panel__header">
            <span>{EDGE_KIND_LABELS[edge!.kind]}</span>
            <h2>{edge!.label}</h2>
            <p>{edge!.source} → {edge!.target}</p>
          </header>
          {edge!.propertyIRI && (
            <section>
              <h3>来源属性</h3>
              <p>{edge!.propertyIRI}</p>
            </section>
          )}
        </>
      )}
    </aside>
  );
}

function compactPanelLabel(fields: ExplicitOntologyField[], predicate: string) {
  return fields.find((field) => field.id === predicate)?.label ?? predicate;
}

export interface ConfigurableOntologyViewerProps {
  data: ExplicitOntologyGraphData;
  initialConfig?: Partial<ExplicitOntologyVisualConfig>;
  storageKey?: string;
  /** Optional content rendered at the right side of the header (e.g. import button). */
  headerRight?: ReactNode;
  /** Called when user selects a recent ontology path to re-open. */
  onRecentOpen?: (path: string) => void;
}

function useSettingsPopover() {
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const configPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isConfigOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsConfigOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (configPopoverRef.current?.contains(target)) return;
      setIsConfigOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isConfigOpen]);

  return { isConfigOpen, setIsConfigOpen, configPopoverRef };
}

const RECENT_STORAGE_KEY = "ontology-viz:recent";
const MAX_RECENT = 10;

interface RecentEntry { path: string; time: number; }

function readRecent(): RecentEntry[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]");
  } catch { return []; }
}

function writeRecent(path: string) {
  const list = readRecent().filter((e) => e.path !== path);
  list.unshift({ path, time: Date.now() });
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

function RecentDropdown({ recent, onSelect }: { recent: RecentEntry[]; onSelect: (path: string) => void }) {
  return (
    <div className="explicit-recent-dropdown">
      {recent.length === 0 && <div className="explicit-recent-dropdown__empty">暂无最近记录</div>}
      {recent.map((e) => (
        <div className="explicit-recent-dropdown__item" key={e.path} onClick={() => onSelect(e.path)}>
          <span className="explicit-recent-dropdown__name">{e.path.replace(/^.*[\\/]/, "")}</span>
          <span className="explicit-recent-dropdown__time">{timeAgo(e.time)}</span>
        </div>
      ))}
    </div>
  );
}

export function ConfigurableOntologyViewer({
  data,
  initialConfig,
  storageKey,
  headerRight,
  onRecentOpen,
}: ConfigurableOntologyViewerProps) {
  const resolvedStorageKey = useMemo(() => configStorageKey(data, storageKey), [data, storageKey]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [config, setConfig] = useState<ExplicitOntologyVisualConfig>(() =>
    createExplicitOntologyConfig(initialConfig, readSavedConfig(resolvedStorageKey)),
  );
  const [recentOpen, setRecentOpen] = useState(false);
  const [recent, setRecent] = useState<RecentEntry[]>(readRecent);
  const recentRef = useRef<HTMLDivElement>(null);
  const { isConfigOpen, setIsConfigOpen, configPopoverRef } = useSettingsPopover();

  useEffect(() => {
    setSelectedId("");
    setSearch("");
    setConfig(createExplicitOntologyConfig(initialConfig, readSavedConfig(resolvedStorageKey)));
    setIsConfigOpen(false);
    if (storageKey) writeRecent(storageKey);
  }, [data, initialConfig, resolvedStorageKey, storageKey]);

  useEffect(() => {
    if (!recentOpen) return undefined;
    const handler = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      if (recentRef.current?.contains(e.target)) return;
      setRecentOpen(false);
    };
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [recentOpen]);

  useEffect(() => {
    if (selectedId) setIsConfigOpen(false);
  }, [selectedId]);

  const handleSelect = useCallback((id: string) => {
    setIsConfigOpen(false);
    setSelectedId((previous) => previous === id ? "" : id);
  }, []);

  const handleClearSelection = useCallback(() => {
    setIsConfigOpen(false);
    setSelectedId("");
  }, []);

  const openRecent = useCallback(() => {
    setRecent(readRecent());
    setRecentOpen((v) => !v);
  }, []);

  const handleRecentSelect = useCallback((path: string) => {
    setRecentOpen(false);
    onRecentOpen?.(path);
  }, [onRecentOpen]);

  const persistConfig = useCallback((nextConfig: ExplicitOntologyVisualConfig) => {
    writeSavedConfig(resolvedStorageKey, nextConfig);
  }, [resolvedStorageKey]);

  const handleConfigChange = useCallback((nextConfig: ExplicitOntologyVisualConfig) => {
    setConfig(nextConfig);
  }, []);

  const handleLayoutChange = useCallback((layoutMode: ExplicitOntologyLayoutMode) => {
    setConfig((current) => {
      const next = { ...current, layoutMode };
      writeSavedConfig(resolvedStorageKey, next);
      return next;
    });
  }, [resolvedStorageKey]);

  const visibleSummary = useMemo(() => {
    const ids = visibleEntityIds(data, config, search.trim());
    return {
      nodes: ids.size,
      edges: data.edges.filter((edge) => edgeVisibleForNodes(edge, ids)).length,
    };
  }, [config, data, search]);

  return (
    <div className="explicit-viewer">
      <header className="explicit-header">
        <div className="explicit-header__logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/><circle cx="12" cy="5" r="2"/><circle cx="12" cy="19" r="2"/>
            <circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
            <line x1="5" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="19" y2="12"/>
            <line x1="9.5" y1="8.5" x2="10.5" y2="10.5"/><line x1="13.5" y1="13.5" x2="14.5" y2="15.5"/>
          </svg>
          OntologyViz
        </div>
        <span className="explicit-header__sep" />
        <span className="explicit-header__name">{data.ontologyTitle ?? "Ontology"}</span>
        <div className="explicit-header__spacer" />
        <div className="explicit-header__dropdown-wrap">
          <button className="explicit-header__btn" type="button" onClick={openRecent}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            最近打开
          </button>
          {recentOpen && (
            <div ref={recentRef}>
              <RecentDropdown recent={recent} onSelect={handleRecentSelect} />
            </div>
          )}
        </div>
        {headerRight}
      </header>
      <main className="explicit-viewer__stage">
        <div className="explicit-viewer__graph-shell">
          <ReactFlowProvider>
            <ConfigurableOntologyGraph
              data={data}
              config={config}
              selectedId={selectedId}
              search={search}
              onSelect={handleSelect}
              onClearSelection={handleClearSelection}
              onSearchChange={setSearch}
              onLayoutChange={handleLayoutChange}
              onSettingsOpen={() => { setSelectedId(""); setIsConfigOpen(true); }}
            />
          </ReactFlowProvider>
        </div>
      </main>
      <footer className="explicit-footer">
        <span>节点 <strong>{visibleSummary.nodes}</strong></span>
        <span>边 <strong>{visibleSummary.edges}</strong></span>
      </footer>
      {isConfigOpen && (
        <div className="explicit-modal-overlay" onClick={() => setIsConfigOpen(false)}>
          <div className="explicit-modal" ref={configPopoverRef} onClick={(e) => e.stopPropagation()}>
            <SettingsModal
              data={data}
              config={config}
              search={search}
              onSearchChange={setSearch}
              onConfigChange={handleConfigChange}
              onSave={() => persistConfig(config)}
              onClose={() => setIsConfigOpen(false)}
            />
          </div>
        </div>
      )}
      {selectedId && (
        <DetailPanel data={data} selectedId={selectedId} onClose={handleClearSelection} />
      )}
    </div>
  );
}

