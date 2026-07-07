import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
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
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  getExplicitOntologyDefaultDescription,
  getExplicitOntologyDefaultLabel,
  getExplicitOntologyDisplayValue,
} from "../lib/explicitOntologyParser";
import { layoutGraph, type GraphLayoutOptions } from "../lib/graphLayout";
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

const CONFIG_STORAGE_PREFIX = "ontology-viz:explicit-config:";

const NODE_SIZE = 36;
const NODE_ORIGIN: [number, number] = [0.5, 0.5];

const FORCE_LINK_DISTANCE = 80;
const FORCE_LINK_STRENGTH = 0.6;
const FORCE_CHARGE_STRENGTH = 200;
const FORCE_CHARGE_MAX_DIST = 800;
const FORCE_COLLIDE_RADIUS = NODE_SIZE / 2 + 2;
const FORCE_COLLIDE_STRENGTH = 0.8;
const FORCE_TICKS = 300;
const FORCE_CENTER_STRENGTH = 0.02;
const FORCE_SPREAD_FACTOR = 80;

const FITVIEW_PADDING = 0.08;
const LAYOUT_VIEWPORT_LIMITS: Record<ExplicitOntologyLayoutMode, { minZoom: number; maxZoom: number }> = {
  layered: { minZoom: 0.04, maxZoom: 5 },
  force: { minZoom: 0.5, maxZoom: 5 },
};

const EXPLICIT_GRAPH_LAYOUT_OPTIONS: GraphLayoutOptions = {
  nodeWidth: NODE_SIZE,
  nodeHeight: NODE_SIZE,
  layered: {
    rankdir: "TB",
    ranksep: 84,
    nodesep: 28,
    edgesep: 14,
    marginx: 24,
    marginy: 24,
  },
  force: {
    linkDistance: FORCE_LINK_DISTANCE,
    linkStrength: FORCE_LINK_STRENGTH,
    chargeStrength: FORCE_CHARGE_STRENGTH,
    chargeDistanceMax: FORCE_CHARGE_MAX_DIST,
    collideRadius: FORCE_COLLIDE_RADIUS,
    collideStrength: FORCE_COLLIDE_STRENGTH,
    collideIterations: 2,
    ticks: FORCE_TICKS,
    centerStrength: FORCE_CENTER_STRENGTH,
    spreadFactor: FORCE_SPREAD_FACTOR,
  },
};

const EDGE_FONT_BASE = 10;
const EDGE_FONT_MIN = 7;
const EDGE_STROKE_MIN = 0.8;
const EDGE_MARKER_SIZE = 16;
const EDGE_STROKE_OBJECT_RELATION = 1.8;
const EDGE_STROKE_DEFAULT = 1.2;

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
  selected: boolean;
  highlighted: boolean;
  color: string;
}

interface ExplicitEdgeData extends Record<string, unknown> {
  edge: ExplicitOntologyEdge;
  selected?: boolean;
  highlighted?: boolean;
}

interface VisibleOntologyGraph {
  entities: ExplicitOntologyEntity[];
  edges: ExplicitOntologyEdge[];
  ids: Set<string>;
}

interface SelectionState {
  selectedNodeId: string;
  selectedEdgeId: string;
  highlightedNodes: Set<string>;
  highlightedEdges: Set<string>;
}

function tint(hex: string, alpha: number) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return `rgba(100,116,139,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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
        width: NODE_SIZE,
        height: NODE_SIZE,
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
        id="center-source"
        className="explicit-ontology-node__center-handle"
        type="source"
        position={Position.Top}
      />
      <Handle
        id="center-target"
        className="explicit-ontology-node__center-handle"
        type="target"
        position={Position.Top}
      />
    </div>
  );
});

const nodeTypes = {
  explicitOntology: ExplicitOntologyNode,
};

function ExplicitEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  label,
  markerEnd,
  style,
}: EdgeProps) {
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const zoom = useStore((s) => s.transform[2]);

  const baseFont = EDGE_FONT_BASE;
  const minFont = EDGE_FONT_MIN;
  const vf = baseFont * zoom;
  let fs = 1;
  if (vf < minFont) fs = minFont / vf;
  if (vf > baseFont) fs = baseFont / vf;

  const baseSW = (style?.strokeWidth as number) ?? 1.2;
  const minSW = EDGE_STROKE_MIN;
  const vsw = baseSW * zoom;
  let sws = 1;
  if (vsw < minSW) sws = minSW / vsw;
  if (vsw > baseSW) sws = baseSW / vsw;

  const scaledStyle = { ...(style ?? {}), strokeWidth: baseSW * sws };
  const mEnd = markerEnd as any;
  const mSize = EDGE_MARKER_SIZE;
  const scaledMarker = mEnd ? {
    ...mEnd,
    width: (mEnd.width ?? mSize) * sws,
    height: (mEnd.height ?? mSize) * sws,
  } : undefined;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={scaledMarker} style={scaledStyle} />
      {label && zoom >= 1 ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${(sourceY + targetY) / 2}px)`,
              fontSize: Math.round(baseFont * fs),
              fontWeight: 600,
              color: "#334155",
              pointerEvents: "all",
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes = {
  explicitEdge: ExplicitEdge,
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
  visibleEntityKinds: ExplicitOntologyEntityKind[],
  search: string,
) {
  const visibleKinds = new Set(visibleEntityKinds);
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

function buildVisibleGraph(
  data: ExplicitOntologyGraphData,
  visibleEntityKinds: ExplicitOntologyEntityKind[],
  search: string,
): VisibleOntologyGraph {
  const ids = visibleEntityIds(data, visibleEntityKinds, search);
  return {
    ids,
    entities: data.entities.filter((entity) => ids.has(entity.id)),
    edges: data.edges.filter((edge) => edgeVisibleForNodes(edge, ids)),
  };
}

function buildNodes(
  entities: ExplicitOntologyEntity[],
  config: ExplicitOntologyVisualConfig,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  selection: SelectionState,
): Node<ExplicitNodeData>[] {
  return entities
    .map((entity) => {
      const color = colorForEntity(entity, config);
      return {
        id: entity.id,
        type: "explicitOntology",
        position: positions.get(entity.id) ?? { x: 0, y: 0 },
        draggable: true,
        data: {
          entity,
          selected: entity.id === selection.selectedNodeId,
          highlighted: selection.highlightedNodes.has(entity.id),
          color,
        },
      };
    });
}

function buildEdges(
  edges: ExplicitOntologyEdge[],
  edgeConfig: ExplicitOntologyVisualConfig["edges"],
  selection: SelectionState,
): Edge<ExplicitEdgeData>[] {
  return edges
    .map((edge) => {
      const color = edgeConfig.colorByKind[edge.kind];
      const selected = edge.id === selection.selectedEdgeId;
      const highlighted = selection.highlightedEdges.has(edge.id);
      return {
        id: edge.id,
        type: "explicitEdge",
        source: edge.source,
        sourceHandle: "center-source",
        target: edge.target,
        targetHandle: "center-target",
        label: edgeConfig.showLabels ? edge.label : undefined,
        markerEnd: edgeConfig.showArrows
          ? {
              type: MarkerType.ArrowClosed,
              width: EDGE_MARKER_SIZE,
              height: EDGE_MARKER_SIZE,
              color,
            }
          : undefined,
        className: [selected ? "is-selected" : "", highlighted ? "is-highlighted" : ""].filter(Boolean).join(" "),
        data: { edge, selected, highlighted },
        style: {
          stroke: color,
          strokeWidth: selected
            ? 3
            : highlighted
              ? 2.4
              : edge.kind === "objectRelation"
                ? EDGE_STROKE_OBJECT_RELATION
                : EDGE_STROKE_DEFAULT,
          strokeDasharray: edge.kind === "subClassOf" ? "5 4" : "none",
        },
      };
    });
}

function buildLayoutPositions(
  graph: VisibleOntologyGraph,
  mode: ExplicitOntologyLayoutMode,
) {
  return layoutGraph(
    graph.entities.map((entity) => ({ id: entity.id, width: NODE_SIZE, height: NODE_SIZE })),
    graph.edges.map((edge) => ({ source: edge.source, target: edge.target })),
    mode,
    EXPLICIT_GRAPH_LAYOUT_OPTIONS,
  );
}

function selectionSets(selectedId: string, graph: VisibleOntologyGraph): SelectionState {
  const highlightedNodes = new Set<string>();
  const highlightedEdges = new Set<string>();
  const selectedNodeId = graph.ids.has(selectedId) ? selectedId : "";
  const selectedEdgeId = graph.edges.some((edge) => edge.id === selectedId) ? selectedId : "";
  if (selectedNodeId) {
    highlightedNodes.add(selectedNodeId);
    for (const edge of graph.edges) {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        highlightedEdges.add(edge.id);
        highlightedNodes.add(edge.source);
        highlightedNodes.add(edge.target);
      }
    }
  } else if (selectedEdgeId) {
    const edge = graph.edges.find((item) => item.id === selectedEdgeId);
    if (edge) {
      highlightedEdges.add(edge.id);
      highlightedNodes.add(edge.source);
      highlightedNodes.add(edge.target);
    }
  }
  return { selectedNodeId, selectedEdgeId, highlightedNodes, highlightedEdges };
}

function LayoutDropdown({
  value,
  onChange,
}: {
  value: ExplicitOntologyLayoutMode;
  onChange: (mode: ExplicitOntologyLayoutMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return undefined;

    popover.setAttribute("popover", "auto");
    const handleToggle = () => setOpen(popover.matches(":popover-open"));
    popover.addEventListener("toggle", handleToggle);
    return () => {
      popover.removeEventListener("toggle", handleToggle);
    };
  }, []);

  const positionPopover = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const rect = trigger.getBoundingClientRect();
    popover.style.setProperty("--layout-popover-left", `${Math.round(rect.left)}px`);
    popover.style.setProperty("--layout-popover-top", `${Math.round(rect.bottom + 6)}px`);
  }, []);

  const togglePopover = useCallback(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    positionPopover();
    popover.togglePopover();
    setOpen(popover.matches(":popover-open"));
  }, [positionPopover]);

  const handleSelect = useCallback((mode: ExplicitOntologyLayoutMode) => {
    if (mode !== value) onChange(mode);
    popoverRef.current?.hidePopover();
    setOpen(false);
  }, [onChange, value]);

  return (
    <div
      className="explicit-canvas-toolbar__layout-menu nodrag nopan"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className="explicit-canvas-toolbar__layout-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={togglePopover}
      >
        <span>{LAYOUT_LABELS[value]}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m7 10 5 5 5-5" />
        </svg>
      </button>
      <div
        ref={popoverRef}
        className="explicit-canvas-toolbar__layout-dropdown nodrag nopan"
        popover="auto"
        role="listbox"
        aria-label="布局"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {(Object.keys(LAYOUT_LABELS) as ExplicitOntologyLayoutMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            role="option"
            aria-selected={mode === value}
            className={mode === value ? "is-selected" : ""}
            onClick={() => handleSelect(mode)}
          >
            <span>{LAYOUT_LABELS[mode]}</span>
            {mode === value && (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m5 13 4 4L19 7" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
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
  const viewportLimits = LAYOUT_VIEWPORT_LIMITS[config.layoutMode];

  const visibleGraph = useMemo(
    () => buildVisibleGraph(data, config.visibleEntityKinds, deferredSearch.trim()),
    [config.visibleEntityKinds, data, deferredSearch],
  );

  const layoutPositions = useMemo(
    () => buildLayoutPositions(visibleGraph, config.layoutMode),
    [config.layoutMode, visibleGraph],
  );

  const selection = useMemo(
    () => selectionSets(selectedId, visibleGraph),
    [selectedId, visibleGraph],
  );

  const rawNodes = useMemo(
    () => buildNodes(visibleGraph.entities, config, layoutPositions, selection),
    [config, layoutPositions, selection, visibleGraph.entities],
  );

  const rawEdges = useMemo(
    () => buildEdges(visibleGraph.edges, config.edges, selection),
    [config.edges, selection, visibleGraph.edges],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ExplicitNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<ExplicitEdgeData>>([]);
  const hasSelection = Boolean(selection.selectedNodeId || selection.selectedEdgeId);

  useEffect(() => {
    setNodes(rawNodes);
    setEdges(rawEdges);
  }, [rawEdges, rawNodes, setEdges, setNodes]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fitView({
        padding: FITVIEW_PADDING,
        duration: visibleGraph.entities.length > 180 ? 0 : 260,
        minZoom: viewportLimits.minZoom,
        maxZoom: viewportLimits.maxZoom,
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [fitView, layoutPositions, viewportLimits.maxZoom, viewportLimits.minZoom, visibleGraph.entities.length]);

  const nodeColor = useCallback((node: Node<ExplicitNodeData>) => node.data.color, []);

  return (
    <div className={`explicit-ontology-graph ${hasSelection ? "has-selection" : ""}`}>
      <ReactFlow
        proOptions={{ hideAttribution: true }}
        nodes={nodes}
        edges={edges}
        nodeOrigin={NODE_ORIGIN}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable
        elementsSelectable
        panOnDrag
        panOnScroll
        autoPanOnNodeDrag
        onlyRenderVisibleElements
        minZoom={viewportLimits.minZoom}
        maxZoom={viewportLimits.maxZoom}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onEdgeClick={(_event, edge) => onSelect(edge.id)}
        onPaneClick={onClearSelection}
      >
        {nodes.length <= 500 && <MiniMap pannable zoomable nodeColor={nodeColor} nodeStrokeWidth={3} />}
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
          <LayoutDropdown value={config.layoutMode} onChange={onLayoutChange} />
          <div className="explicit-canvas-toolbar__sep" />
          <div className="explicit-canvas-toolbar__zoom">
            <button
              title="适应画布"
              onClick={() => fitView({
                padding: FITVIEW_PADDING,
                duration: 260,
                minZoom: viewportLimits.minZoom,
                maxZoom: viewportLimits.maxZoom,
              })}
            >
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
  /** Called when user selects a recent ontology storage key to re-open. */
  onRecentOpen?: (storageKey: string) => void;
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

interface RecentEntry { key: string; label: string; time: number; }

interface LegacyRecentEntry { path?: string; key?: string; label?: string; time?: number; }

function labelFromRecentKey(key: string) {
  if (key.startsWith("file:")) {
    const withoutPrefix = key.slice("file:".length);
    const lastColon = withoutPrefix.lastIndexOf(":");
    const secondLastColon = lastColon > -1 ? withoutPrefix.lastIndexOf(":", lastColon - 1) : -1;
    if (secondLastColon > -1) return withoutPrefix.slice(0, secondLastColon) || "Ontology";
    return withoutPrefix || "Ontology";
  }

  const source = key.startsWith("url:") ? key.slice("url:".length) : key;
  const clean = source.split(/[?#]/)[0] ?? source;
  return clean.split(/[\\/]/).filter(Boolean).at(-1) || source || "Ontology";
}

function normalizeRecentEntry(entry: LegacyRecentEntry): RecentEntry | null {
  const key = typeof entry.key === "string" ? entry.key : entry.path;
  if (!key) return null;
  return {
    key,
    label: typeof entry.label === "string" && entry.label.trim()
      ? entry.label
      : labelFromRecentKey(key),
    time: typeof entry.time === "number" ? entry.time : Date.now(),
  };
}

function readRecent(): RecentEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => normalizeRecentEntry(entry as LegacyRecentEntry))
      .filter((entry): entry is RecentEntry => Boolean(entry));
  } catch { return []; }
}

function writeRecent(key: string) {
  const label = labelFromRecentKey(key);
  const list = readRecent().filter((e) => e.key !== key);
  list.unshift({ key, label, time: Date.now() });
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

function RecentDropdown({ recent, onSelect }: { recent: RecentEntry[]; onSelect: (key: string) => void }) {
  return (
    <div className="explicit-recent-dropdown">
      {recent.length === 0 && <div className="explicit-recent-dropdown__empty">暂无最近记录</div>}
      {recent.map((e) => (
        <div className="explicit-recent-dropdown__item" key={e.key} onClick={() => onSelect(e.key)}>
          <span className="explicit-recent-dropdown__name" title={e.label}>{e.label}</span>
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
    const ids = visibleEntityIds(data, config.visibleEntityKinds, search.trim());
    return {
      nodes: ids.size,
      edges: data.edges.filter((edge) => edgeVisibleForNodes(edge, ids)).length,
    };
  }, [config.visibleEntityKinds, data, search]);

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
