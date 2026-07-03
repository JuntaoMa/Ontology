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
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  layered: "层次",
  force: "力导向",
  typeGroups: "分组",
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
  layoutMode: "layered",
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

const ExplicitOntologyNode = memo(function ExplicitOntologyNode({
  data,
}: NodeProps<Node<ExplicitNodeData>>) {
  const { entity, config, fields, color } = data;
  const title = getExplicitOntologyDisplayValue(entity, config.card.titleField) || getExplicitOntologyDefaultLabel(entity);
  const subtitle = getExplicitOntologyDisplayValue(entity, config.card.subtitleField);
  const description = config.card.descriptionField
    ? getExplicitOntologyDisplayValue(entity, config.card.descriptionField) || getExplicitOntologyDefaultDescription(entity)
    : "";
  const badges = config.card.badgeFields.flatMap((fieldId) => {
    const value = getExplicitOntologyDisplayValue(entity, fieldId);
    return value ? [{ fieldId, value }] : [];
  });

  const style: CSSProperties = {
    borderLeft: `4px solid ${color}`,
    background: "#fff",
    boxShadow: data.selected
      ? `0 0 0 2px ${tint(color, 0.42)}, 0 8px 20px rgba(15,23,42,0.16)`
      : data.highlighted
        ? `0 0 0 2px ${tint(color, 0.32)}, 0 5px 14px rgba(15,23,42,0.12)`
        : "0 1px 3px rgba(15,23,42,0.08)",
  };

  return (
    <div
      className={[
        "explicit-ontology-node",
        data.selected ? "is-selected" : "",
        data.highlighted ? "is-highlighted" : "",
      ].filter(Boolean).join(" ")}
      style={style}
    >
      <Handle
        id="center-target"
        className="explicit-ontology-node__center-handle"
        type="target"
        position={Position.Top}
      />
      <Handle
        id="center-source"
        className="explicit-ontology-node__center-handle"
        type="source"
        position={Position.Top}
      />
      <div className="explicit-ontology-node__header">
        <span className="explicit-ontology-node__type" style={{ background: color }}>
          {ENTITY_KIND_LABELS[entity.kind]}
        </span>
        {badges.slice(0, 2).map((badge) => (
          <span className="explicit-ontology-node__badge" title={badge.value} key={badge.fieldId}>
            {fieldLabel(fields, badge.fieldId)}: {badge.value}
          </span>
        ))}
      </div>
      <div className="explicit-ontology-node__title">{title}</div>
      {subtitle && <div className="explicit-ontology-node__subtitle">{subtitle}</div>}
      {description && <div className="explicit-ontology-node__description">{description}</div>}
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
  const seeded = layoutLayered(nodes, edges);
  const simNodes = seeded.map((node) => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
  }));
  const ids = new Set(nodes.map((node) => node.id));
  const links = edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));

  const sim = forceSimulation(simNodes)
    .force("link", forceLink(links).id((item: any) => item.id).distance(260).strength(0.34))
    .force("charge", forceManyBody().strength(-420).distanceMax(1500))
    .force("center", forceCenter(0, 0))
    .force("x", forceX(0).strength(0.025))
    .force("y", forceY(0).strength(0.025))
    .force("collide", forceCollide(NODE_WIDTH * 0.62).strength(0.85).iterations(2))
    .stop();
  for (let index = 0; index < 220; index += 1) sim.tick();
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const simNode = byId.get(node.id);
    return {
      ...node,
      position: simNode ? { x: simNode.x, y: simNode.y } : node.position,
    };
  });
}

function layoutTypeGroups(nodes: Node<ExplicitNodeData>[]) {
  const kinds: ExplicitOntologyEntityKind[] = ["Class", "ObjectProperty", "DatatypeProperty", "AnnotationProperty"];
  const grouped = new Map(kinds.map((kind) => [kind, nodes.filter((node) => node.data.entity.kind === kind)]));
  const colGap = NODE_WIDTH + 120;
  const rowGap = NODE_HEIGHT + 34;
  return kinds.flatMap((kind, columnIndex) => {
    const groupNodes = grouped.get(kind) ?? [];
    return groupNodes.map((node, rowIndex) => ({
      ...node,
      position: {
        x: columnIndex * colGap,
        y: rowIndex * rowGap,
      },
    }));
  });
}

function applyLayout(
  nodes: Node<ExplicitNodeData>[],
  edges: Edge<ExplicitEdgeData>[],
  mode: ExplicitOntologyLayoutMode,
) {
  if (mode === "force") return layoutForce(nodes, edges);
  if (mode === "typeGroups") return layoutTypeGroups(nodes);
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
}: {
  data: ExplicitOntologyGraphData;
  config: ExplicitOntologyVisualConfig;
  selectedId: string;
  search: string;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
}) {
  const { fitView } = useReactFlow();
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
        <Controls showInteractive={false} />
        <Background gap={20} size={1} />
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

function ConfigPanel({
  data,
  config,
  search,
  onSearchChange,
  onConfigChange,
  onSave,
  saveLabel,
  onClose,
}: {
  data: ExplicitOntologyGraphData;
  config: ExplicitOntologyVisualConfig;
  search: string;
  onSearchChange: (value: string) => void;
  onConfigChange: (config: ExplicitOntologyVisualConfig) => void;
  onSave: () => void;
  saveLabel: string;
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
    <aside className="explicit-config-panel" role="dialog" aria-modal="false" aria-label="设置">
      <div className="explicit-config-panel__header">
        <h2>设置</h2>
        <div className="explicit-config-panel__actions">
          <button className="explicit-config-save" type="button" onClick={onSave}>
            {saveLabel}
          </button>
          <button className="explicit-config-panel__close" type="button" onClick={onClose} aria-label="关闭设置">
            ×
          </button>
        </div>
      </div>

      <section className="explicit-config-section explicit-config-section--first">
        <h3>检索</h3>
        <label className="explicit-config-field">
          <span>关键词</span>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="IRI、名称、注解值"
          />
        </label>
      </section>

      <section className="explicit-config-section">
        <h3>实体类型</h3>
        <div className="explicit-config-checks">
          {(Object.keys(ENTITY_KIND_LABELS) as ExplicitOntologyEntityKind[]).map((kind) => (
            <label key={kind}>
              <input
                type="checkbox"
                checked={config.visibleEntityKinds.includes(kind)}
                onChange={() => toggleType(kind)}
              />
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
              <button
                type="button"
                className={config.card.badgeFields.includes(field.id) ? "is-active" : ""}
                onClick={() => toggleBadge(field.id)}
                key={field.id}
              >
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
          <FieldSelect
            label="颜色字段"
            value={config.color.field ?? "namespace"}
            fields={data.fields}
            onChange={(value) => updateColor({ field: value })}
          />
        )}
      </section>

      <section className="explicit-config-section">
        <h3>边</h3>
        <label className="explicit-config-switch">
          <input type="checkbox" checked={config.edges.showLabels} onChange={(event) => updateEdges({ showLabels: event.target.checked })} />
          <span>显示边标签</span>
        </label>
        <label className="explicit-config-switch">
          <input type="checkbox" checked={config.edges.showArrows} onChange={(event) => updateEdges({ showArrows: event.target.checked })} />
          <span>显示箭头</span>
        </label>
      </section>
    </aside>
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

function compactNumber(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export interface ConfigurableOntologyViewerProps {
  data: ExplicitOntologyGraphData;
  initialConfig?: Partial<ExplicitOntologyVisualConfig>;
  storageKey?: string;
}

export function ConfigurableOntologyViewer({
  data,
  initialConfig,
  storageKey,
}: ConfigurableOntologyViewerProps) {
  const resolvedStorageKey = useMemo(() => configStorageKey(data, storageKey), [data, storageKey]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [config, setConfig] = useState<ExplicitOntologyVisualConfig>(() =>
    createExplicitOntologyConfig(initialConfig, readSavedConfig(resolvedStorageKey)),
  );
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState("保存");
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const configPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedId("");
    setSearch("");
    setConfig(createExplicitOntologyConfig(initialConfig, readSavedConfig(resolvedStorageKey)));
    setIsConfigOpen(false);
    setSaveLabel("保存");
  }, [data, initialConfig, resolvedStorageKey]);

  useEffect(() => {
    if (!isConfigOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsConfigOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (configPopoverRef.current?.contains(target)) return;
      if (settingsButtonRef.current?.contains(target)) return;
      setIsConfigOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isConfigOpen]);

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

  const handleSettingsButtonClick = useCallback(() => {
    setSelectedId("");
    setIsConfigOpen((current) => selectedId ? true : !current);
  }, [selectedId]);

  const persistConfig = useCallback((nextConfig: ExplicitOntologyVisualConfig) => {
    const saved = writeSavedConfig(resolvedStorageKey, nextConfig);
    setSaveLabel(saved ? "已保存" : "保存失败");
    window.setTimeout(() => setSaveLabel("保存"), 1400);
  }, [resolvedStorageKey]);

  const handleConfigChange = useCallback((nextConfig: ExplicitOntologyVisualConfig) => {
    setConfig(nextConfig);
    setSaveLabel("保存");
  }, []);

  const handleLayoutChange = useCallback((layoutMode: ExplicitOntologyLayoutMode) => {
    setConfig((current) => {
      const next = { ...current, layoutMode };
      writeSavedConfig(resolvedStorageKey, next);
      return next;
    });
    setSaveLabel("已保存");
    window.setTimeout(() => setSaveLabel("保存"), 1400);
  }, [resolvedStorageKey]);

  const handleSave = useCallback(() => persistConfig(config), [config, persistConfig]);

  const visibleSummary = useMemo(() => {
    const ids = visibleEntityIds(data, config, search.trim());
    return {
      nodes: ids.size,
      edges: data.edges.filter((edge) => edgeVisibleForNodes(edge, ids)).length,
    };
  }, [config, data, search]);

  return (
    <div className="explicit-viewer">
      <main className="explicit-viewer__stage">
        <div className="explicit-stage-bar">
          <div className="explicit-stage-bar__title">
            <strong>{data.ontologyTitle ?? "Ontology"}</strong>
          </div>
          <div className="explicit-stage-bar__tools">
            <div className="explicit-layout-toggle" aria-label="布局">
              {(Object.keys(LAYOUT_LABELS) as ExplicitOntologyLayoutMode[]).map((layoutMode) => (
                <button
                  type="button"
                  className={config.layoutMode === layoutMode ? "is-active" : ""}
                  onClick={() => handleLayoutChange(layoutMode)}
                  key={layoutMode}
                >
                  {LAYOUT_LABELS[layoutMode]}
                </button>
              ))}
            </div>
            <div className="explicit-stage-bar__metrics" aria-label="当前图谱规模">
              <span><strong>{compactNumber(visibleSummary.nodes)}</strong> 节点</span>
              <span><strong>{compactNumber(visibleSummary.edges)}</strong> 边</span>
              <span><strong>{config.visibleEntityKinds.length}</strong> 类型</span>
            </div>
            <button
              ref={settingsButtonRef}
              className="explicit-settings-button"
              type="button"
              onClick={handleSettingsButtonClick}
              aria-label="打开设置"
              title="设置"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 0 1 0-4h.08A1.7 1.7 0 0 0 4.64 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 0 1 4 0v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.04A1.7 1.7 0 0 0 20.96 10H21a2 2 0 0 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="explicit-viewer__graph-shell">
          <ReactFlowProvider>
            <ConfigurableOntologyGraph
              data={data}
              config={config}
              selectedId={selectedId}
              search={search}
              onSelect={handleSelect}
              onClearSelection={handleClearSelection}
            />
          </ReactFlowProvider>
        </div>
      </main>
      {isConfigOpen && !selectedId && (
        <div className="explicit-config-popover" ref={configPopoverRef}>
          <ConfigPanel
            data={data}
            config={config}
            search={search}
            onSearchChange={setSearch}
            onConfigChange={handleConfigChange}
            onSave={handleSave}
            saveLabel={saveLabel}
            onClose={() => setIsConfigOpen(false)}
          />
        </div>
      )}
      {selectedId && (
        <DetailPanel data={data} selectedId={selectedId} onClose={handleClearSelection} />
      )}
    </div>
  );
}
