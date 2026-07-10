import { CanvasEvent, EdgeEvent, Graph, NodeEvent, type GraphData, type GraphOptions } from "@antv/g6";
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";

import type { OntologyGraphData, OntologyLayoutPosition, OntologyLayoutSnapshot } from "../core";
import {
  createG6LayoutOptions,
  toG6GraphData,
  type OntologyG6AdapterOptions,
  type OntologyG6LayoutMode,
} from "../g6";

const DEFAULT_BEHAVIORS: GraphOptions["behaviors"] = [
  "drag-canvas",
  "zoom-canvas",
  "drag-element",
  "click-select",
  "hover-activate",
  "auto-adapt-label",
  "optimize-viewport-transform",
];

export interface OntologyGraphCanvasProps {
  data: OntologyGraphData;
  adapterOptions?: OntologyG6AdapterOptions;
  layoutMode?: OntologyG6LayoutMode;
  className?: string;
  style?: CSSProperties;
  behaviors?: GraphOptions["behaviors"];
  plugins?: GraphOptions["plugins"];
  layoutSnapshot?: OntologyLayoutSnapshot;
  focusedElementId?: string;
  selectedElementId?: string;
  onNodeSelect?: (id: string) => void;
  onEdgeSelect?: (id: string) => void;
  onCanvasClick?: () => void;
  onLayoutSnapshotChange?: (snapshot: OntologyLayoutSnapshot) => void;
  onGraphReady?: (graph: Graph) => void;
}

function getTargetId(event: unknown) {
  if (!event || typeof event !== "object" || !("target" in event)) return undefined;
  const target = event.target as {
    id?: unknown;
    get?: (key: string) => unknown;
    attributes?: { id?: unknown };
  } | undefined;

  const id = target?.id ?? target?.get?.("id") ?? target?.attributes?.id;
  return typeof id === "string" ? id : undefined;
}

function getElementStateMap(data: GraphData, selectedElementId?: string) {
  const nodeIds = new Set((data.nodes ?? []).map((node) => String(node.id)));
  const edgeIds = new Set((data.edges ?? []).flatMap((edge) => edge.id ? [String(edge.id)] : []));
  const states: Record<string, string[]> = {};

  for (const id of [...nodeIds, ...edgeIds]) states[id] = [];
  if (!selectedElementId) return states;

  const relatedNodes = new Set<string>();
  const relatedEdges = new Set<string>();

  if (nodeIds.has(selectedElementId)) {
    relatedNodes.add(selectedElementId);
    for (const edge of data.edges ?? []) {
      const edgeId = edge.id ? String(edge.id) : undefined;
      const source = String(edge.source);
      const target = String(edge.target);
      if (!edgeId || (source !== selectedElementId && target !== selectedElementId)) continue;
      relatedEdges.add(edgeId);
      relatedNodes.add(source);
      relatedNodes.add(target);
    }
  } else if (edgeIds.has(selectedElementId)) {
    relatedEdges.add(selectedElementId);
    const edge = (data.edges ?? []).find((item) => item.id === selectedElementId);
    if (edge) {
      relatedNodes.add(String(edge.source));
      relatedNodes.add(String(edge.target));
    }
  }

  for (const id of nodeIds) {
    if (id === selectedElementId) states[id] = ["selected"];
    else states[id] = relatedNodes.has(id) ? ["related"] : ["dimmed"];
  }
  for (const id of edgeIds) {
    if (id === selectedElementId) states[id] = ["selected"];
    else states[id] = relatedEdges.has(id) ? ["related"] : ["dimmed"];
  }

  return states;
}

function getSnapshotPosition(snapshot: OntologyLayoutSnapshot | undefined, id: unknown) {
  return typeof id === "string" ? snapshot?.nodes[id] : undefined;
}

function hasCompleteLayoutSnapshot(data: GraphData, snapshot?: OntologyLayoutSnapshot) {
  const nodes = data.nodes ?? [];
  return nodes.length > 0 && nodes.every((node) => !!getSnapshotPosition(snapshot, node.id));
}

function withLayoutSnapshot(data: GraphData, snapshot?: OntologyLayoutSnapshot): GraphData {
  if (!snapshot) return data;
  return {
    ...data,
    nodes: data.nodes?.map((node) => {
      const position = getSnapshotPosition(snapshot, node.id);
      if (!position) return node;
      return {
        ...node,
        style: {
          ...node.style,
          x: position.x,
          y: position.y,
          z: position.z,
        },
      };
    }),
  };
}

function toG6Position(position: OntologyLayoutPosition): [number, number] | [number, number, number] {
  return typeof position.z === "number" ? [position.x, position.y, position.z] : [position.x, position.y];
}

function toG6Positions(snapshot: OntologyLayoutSnapshot) {
  return Object.fromEntries(
    Object.entries(snapshot.nodes).map(([id, position]) => [id, toG6Position(position)]),
  );
}

function readLayoutSnapshot(graph: Graph, data: GraphData): OntologyLayoutSnapshot | undefined {
  const nodes: Record<string, OntologyLayoutPosition> = {};
  for (const node of data.nodes ?? []) {
    if (typeof node.id !== "string") continue;
    try {
      const point = Array.from(graph.getElementPosition(node.id));
      const [x, y, z] = point;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        nodes[node.id] = typeof z === "number" && Number.isFinite(z) ? { x, y, z } : { x, y };
      }
    } catch {
      // The element may be filtered out or not drawn yet.
    }
  }

  return Object.keys(nodes).length > 0 ? { nodes, updatedAt: Date.now() } : undefined;
}

function hasGraphElement(data: GraphData, id: string) {
  return (data.nodes ?? []).some((node) => node.id === id)
    || (data.edges ?? []).some((edge) => edge.id === id);
}

export function OntologyGraphCanvas({
  data,
  adapterOptions,
  layoutMode = "force-atlas2",
  className,
  style,
  behaviors = DEFAULT_BEHAVIORS,
  plugins,
  layoutSnapshot,
  focusedElementId,
  selectedElementId,
  onNodeSelect,
  onEdgeSelect,
  onCanvasClick,
  onLayoutSnapshotChange,
  onGraphReady,
}: OntologyGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const graphDataRef = useRef<GraphData>({ nodes: [], edges: [] });
  const renderRevisionRef = useRef(0);
  const completedRenderRevisionRef = useRef(0);
  const selectedElementIdRef = useRef(selectedElementId);
  const focusedElementIdRef = useRef(focusedElementId);
  const callbacksRef = useRef({
    onNodeSelect,
    onEdgeSelect,
    onCanvasClick,
    onLayoutSnapshotChange,
    onGraphReady,
  });

  callbacksRef.current = {
    onNodeSelect,
    onEdgeSelect,
    onCanvasClick,
    onLayoutSnapshotChange,
    onGraphReady,
  };
  selectedElementIdRef.current = selectedElementId;
  focusedElementIdRef.current = focusedElementId;

  const baseGraphData = useMemo<GraphData>(
    () => toG6GraphData(data, adapterOptions),
    [adapterOptions, data],
  );
  const usesLayoutSnapshot = useMemo(
    () => hasCompleteLayoutSnapshot(baseGraphData, layoutSnapshot),
    [baseGraphData, layoutSnapshot],
  );
  const graphData = useMemo<GraphData>(
    () => usesLayoutSnapshot ? withLayoutSnapshot(baseGraphData, layoutSnapshot) : baseGraphData,
    [baseGraphData, layoutSnapshot, usesLayoutSnapshot],
  );
  const layout = useMemo<NonNullable<GraphOptions["layout"]>>(
    () => usesLayoutSnapshot
      ? { type: "grid", nodeFilter: () => false }
      : createG6LayoutOptions(layoutMode, adapterOptions?.nodeSize) as NonNullable<GraphOptions["layout"]>,
    [adapterOptions?.nodeSize, layoutMode, usesLayoutSnapshot],
  );

  graphDataRef.current = graphData;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const graph = new Graph({
      container,
      autoFit: "view",
      autoResize: true,
      behaviors,
      plugins,
      node: {
        state: {
          selected: {
            lineWidth: 3,
            stroke: "#1f64e7",
            halo: true,
            haloStroke: "#1f64e7",
          },
          related: {
            lineWidth: 2,
            stroke: "#1f64e7",
          },
          dimmed: {
            opacity: 0.22,
          },
        },
      },
      edge: {
        state: {
          selected: {
            lineWidth: 3,
            stroke: "#1f64e7",
          },
          related: {
            lineWidth: 2,
            stroke: "#1f64e7",
          },
          dimmed: {
            opacity: 0.16,
          },
        },
      },
    });

    graphRef.current = graph;
    graph.on(NodeEvent.CLICK, (event) => {
      const id = getTargetId(event);
      if (id) callbacksRef.current.onNodeSelect?.(id);
    });
    graph.on(EdgeEvent.CLICK, (event) => {
      const id = getTargetId(event);
      if (id) callbacksRef.current.onEdgeSelect?.(id);
    });
    graph.on(CanvasEvent.CLICK, () => {
      callbacksRef.current.onCanvasClick?.();
    });
    graph.on(NodeEvent.DRAG_END, () => {
      const snapshot = readLayoutSnapshot(graph, graphDataRef.current);
      if (snapshot) callbacksRef.current.onLayoutSnapshotChange?.(snapshot);
    });

    callbacksRef.current.onGraphReady?.(graph);

    return () => {
      renderRevisionRef.current += 1;
      completedRenderRevisionRef.current = 0;
      if (graphRef.current === graph) graphRef.current = null;
      graph.destroy();
    };
  }, [behaviors, plugins]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const revision = renderRevisionRef.current + 1;
    renderRevisionRef.current = revision;
    completedRenderRevisionRef.current = 0;
    let cancelled = false;

    const timeoutId = window.setTimeout(() => {
      if (cancelled || graph.destroyed || graphRef.current !== graph) return;

      void (async () => {
        const isCurrentRender = () => (
          !cancelled
          && !graph.destroyed
          && graphRef.current === graph
          && renderRevisionRef.current === revision
        );

        graph.setData(graphData);
        graph.setLayout(layout);
        await graph.render();
        if (!isCurrentRender()) return;

        if (usesLayoutSnapshot && layoutSnapshot) {
          await graph.translateElementTo(toG6Positions(layoutSnapshot), false);
          if (!isCurrentRender()) return;
        }

        let appliedSelectedId: string | undefined;
        do {
          appliedSelectedId = selectedElementIdRef.current;
          await graph.setElementState(getElementStateMap(graphData, appliedSelectedId), false);
          if (!isCurrentRender()) return;
        } while (selectedElementIdRef.current !== appliedSelectedId);

        completedRenderRevisionRef.current = revision;

        const focusedId = focusedElementIdRef.current;
        if (focusedId && hasGraphElement(graphData, focusedId)) {
          await graph.focusElement(focusedId, {
            duration: 300,
            easing: "ease-in-out",
          });
          if (!isCurrentRender()) return;
        }

        if (!usesLayoutSnapshot) {
          const snapshot = readLayoutSnapshot(graph, graphData);
          if (snapshot) callbacksRef.current.onLayoutSnapshotChange?.(snapshot);
        }
      })().catch((error) => {
        if (!cancelled && !graph.destroyed && graphRef.current === graph) {
          console.error("[OntologyViz] Failed to render graph", error);
        }
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [behaviors, graphData, layout, layoutSnapshot, plugins, usesLayoutSnapshot]);

  useEffect(() => {
    const graph = graphRef.current;
    if (
      !graph
      || graph.destroyed
      || completedRenderRevisionRef.current !== renderRevisionRef.current
    ) {
      return;
    }

    void graph.setElementState(getElementStateMap(graphData, selectedElementId), false).catch((error) => {
      if (!graph.destroyed && graphRef.current === graph) {
        console.error("[OntologyViz] Failed to update element state", error);
      }
    });
  }, [graphData, selectedElementId]);

  useEffect(() => {
    const graph = graphRef.current;
    if (
      !graph
      || graph.destroyed
      || !focusedElementId
      || !hasGraphElement(graphDataRef.current, focusedElementId)
      || completedRenderRevisionRef.current !== renderRevisionRef.current
    ) {
      return;
    }

    void graph.focusElement(focusedElementId, {
      duration: 300,
      easing: "ease-in-out",
    }).catch((error) => {
      if (!graph.destroyed && graphRef.current === graph) {
        console.error("[OntologyViz] Failed to focus element", error);
      }
    });
  }, [focusedElementId]);

  return (
    <div
      ref={containerRef}
      className={className ?? "ontology-viz-graph-canvas"}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 360,
        ...style,
      }}
    />
  );
}
