import {
  CanvasEvent,
  EdgeEvent,
  Graph,
  NodeEvent,
  type GraphData,
  type GraphOptions,
  type IViewportEvent,
} from "@antv/g6";
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";

import type { OntologyGraphData, OntologyLayoutPosition, OntologyLayoutSnapshot } from "../core";
import {
  createG6DegreeNodeSizeTransform,
  createG6LayoutOptions,
  toG6GraphData,
  type OntologyG6AdapterOptions,
  type OntologyG6LayoutMode,
} from "../g6";

const DEFAULT_BEHAVIORS: GraphOptions["behaviors"] = [
  "drag-canvas",
  "zoom-canvas",
  {
    type: "fix-element-size",
    key: "ontology-fix-element-size",
    enable: (event: IViewportEvent) => (event.data.scale ?? 1) > 1,
    reset: true,
  },
  "drag-element",
  {
    type: "hover-activate",
    key: "ontology-hover-activate",
    animation: false,
    degree: 0,
    state: "hovered",
  },
  {
    type: "click-select",
    key: "ontology-click-select",
    animation: false,
    degree: 1,
    state: "selected",
    neighborState: "related",
  },
  {
    type: "optimize-viewport-transform",
    key: "ontology-optimize-viewport",
    shapes: { node: ["key"] },
  },
];

const DEFAULT_TRANSFORMS: GraphOptions["transforms"] = [
  createG6DegreeNodeSizeTransform(),
];

const NO_NATIVE_SELECTION = Symbol("no-native-selection");
type PendingNativeSelection = string | undefined | typeof NO_NATIVE_SELECTION;

export interface OntologyGraphCanvasProps {
  data: OntologyGraphData;
  adapterOptions?: OntologyG6AdapterOptions;
  layoutMode?: OntologyG6LayoutMode;
  className?: string;
  style?: CSSProperties;
  behaviors?: GraphOptions["behaviors"];
  plugins?: GraphOptions["plugins"];
  transforms?: GraphOptions["transforms"];
  layoutSnapshot?: OntologyLayoutSnapshot;
  focusedElementId?: string;
  selectedElementId?: string;
  onNodeSelect?: (id: string) => void;
  onEdgeSelect?: (id: string) => void;
  onCanvasClick?: () => void;
  onLayoutSnapshotChange?: (snapshot: OntologyLayoutSnapshot) => void;
  onGraphReady?: (graph: Graph) => void;
}

function hasClickSelectBehavior(behaviors: GraphOptions["behaviors"]) {
  return behaviors?.some((behavior) => {
    if (typeof behavior === "string") return behavior === "click-select";
    if (typeof behavior === "function") return false;
    return behavior.type === "click-select";
  }) ?? false;
}

const CONTROLLED_SELECTION_STATES = new Set(["selected", "related"]);

function getControlledSelectionStateMap(
  graph: Graph,
  data: GraphData,
  selectedElementId?: string,
) {
  const nodeIds = new Set((data.nodes ?? []).map((node) => String(node.id)));
  const edgeIds = new Set((data.edges ?? []).flatMap((edge) => edge.id ? [String(edge.id)] : []));
  const states: Record<string, string[]> = {};

  for (const state of CONTROLLED_SELECTION_STATES) {
    const controlledData = [
      ...graph.getElementDataByState("node", state),
      ...graph.getElementDataByState("edge", state),
    ];
    for (const datum of controlledData) {
      const id = String(datum.id);
      if (states[id]) continue;
      states[id] = graph.getElementState(id)
        .filter((currentState) => !CONTROLLED_SELECTION_STATES.has(currentState));
    }
  }
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

  const addState = (id: string, state: string) => {
    const currentStates = states[id]
      ?? graph.getElementState(id)
        .filter((currentState) => !CONTROLLED_SELECTION_STATES.has(currentState));
    states[id] = [...currentStates, state];
  };

  for (const id of relatedNodes) {
    addState(id, id === selectedElementId ? "selected" : "related");
  }
  for (const id of relatedEdges) {
    addState(id, id === selectedElementId ? "selected" : "related");
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

function isElementSelected(graph: Graph, id: string) {
  try {
    return graph.getElementState(id).includes("selected");
  } catch {
    return false;
  }
}

export function OntologyGraphCanvas({
  data,
  adapterOptions,
  layoutMode = "force-atlas2",
  className,
  style,
  behaviors = DEFAULT_BEHAVIORS,
  plugins,
  transforms = DEFAULT_TRANSFORMS,
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
  const hasRenderedRef = useRef(false);
  const renderedLayoutModeRef = useRef<OntologyG6LayoutMode | undefined>(undefined);
  const pendingNativeSelectionRef = useRef<PendingNativeSelection>(NO_NATIVE_SELECTION);
  const previousSelectedElementIdRef = useRef(selectedElementId);
  const lastEmittedLayoutSnapshotRef = useRef<OntologyLayoutSnapshot | undefined>(undefined);
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

  const usesNativeClickSelect = useMemo(
    () => hasClickSelectBehavior(behaviors),
    [behaviors],
  );

  const baseGraphData = useMemo<GraphData>(
    () => toG6GraphData(data, adapterOptions),
    [adapterOptions, data],
  );
  const usesLayoutSnapshot = useMemo(
    () => layoutSnapshot !== lastEmittedLayoutSnapshotRef.current
      && hasCompleteLayoutSnapshot(baseGraphData, layoutSnapshot),
    [baseGraphData, layoutSnapshot],
  );
  const graphData = useMemo<GraphData>(
    () => usesLayoutSnapshot ? withLayoutSnapshot(baseGraphData, layoutSnapshot) : baseGraphData,
    [baseGraphData, layoutSnapshot, usesLayoutSnapshot],
  );
  const layout = useMemo<GraphOptions["layout"]>(
    () => usesLayoutSnapshot
      ? undefined
      : createG6LayoutOptions(layoutMode),
    [layoutMode, usesLayoutSnapshot],
  );

  graphDataRef.current = graphData;

  useEffect(() => {
    if (layoutSnapshot && layoutSnapshot === lastEmittedLayoutSnapshotRef.current) {
      lastEmittedLayoutSnapshotRef.current = undefined;
    }
  }, [layoutSnapshot]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const graph = new Graph({
      container,
      animation: false,
      autoFit: "view",
      autoResize: true,
      behaviors,
      plugins,
      transforms,
      node: {
        state: {
          hovered: {
            fillOpacity: 1,
            labelOpacity: 1,
            lineWidth: 3,
            stroke: "#1f64e7",
          },
          selected: {
            fillOpacity: 1,
            labelOpacity: 1,
            lineWidth: 3,
            stroke: "#1f64e7",
            halo: true,
            haloStroke: "#1f64e7",
          },
          related: {
            fillOpacity: 1,
            labelOpacity: 1,
            lineWidth: 2,
            stroke: "#1f64e7",
          },
        },
      },
      edge: {
        state: {
          hovered: {
            lineWidth: 2,
            stroke: "#1f64e7",
            strokeOpacity: 1,
            labelOpacity: 1,
          },
          selected: {
            lineWidth: 3,
            stroke: "#1f64e7",
            strokeOpacity: 1,
            labelOpacity: 1,
          },
          related: {
            lineWidth: 2,
            stroke: "#1f64e7",
            strokeOpacity: 0.9,
            labelOpacity: 1,
          },
        },
      },
    });

    graphRef.current = graph;
    graph.on(NodeEvent.CLICK, (event) => {
      if (!("target" in event) || !event.target) return;
      const id = String((event.target as { id: unknown }).id);
      if (usesNativeClickSelect) pendingNativeSelectionRef.current = id;
      callbacksRef.current.onNodeSelect?.(id);
    });
    graph.on(EdgeEvent.CLICK, (event) => {
      if (!("target" in event) || !event.target) return;
      const id = String((event.target as { id: unknown }).id);
      if (usesNativeClickSelect) pendingNativeSelectionRef.current = id;
      callbacksRef.current.onEdgeSelect?.(id);
    });
    graph.on(CanvasEvent.CLICK, () => {
      if (usesNativeClickSelect) pendingNativeSelectionRef.current = undefined;
      callbacksRef.current.onCanvasClick?.();
    });
    graph.on(NodeEvent.DRAG_END, () => {
      const snapshot = readLayoutSnapshot(graph, graphDataRef.current);
      if (snapshot) {
        lastEmittedLayoutSnapshotRef.current = snapshot;
        callbacksRef.current.onLayoutSnapshotChange?.(snapshot);
      }
    });

    callbacksRef.current.onGraphReady?.(graph);

    return () => {
      renderRevisionRef.current += 1;
      completedRenderRevisionRef.current = 0;
      hasRenderedRef.current = false;
      renderedLayoutModeRef.current = undefined;
      pendingNativeSelectionRef.current = NO_NATIVE_SELECTION;
      if (graphRef.current === graph) graphRef.current = null;
      graph.destroy();
    };
  }, [behaviors, plugins, transforms, usesNativeClickSelect]);

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

        const previousLayoutMode = renderedLayoutModeRef.current;
        if (!usesLayoutSnapshot && previousLayoutMode && previousLayoutMode !== layoutMode) {
          await graph.clear();
          if (!isCurrentRender()) return;
        }

        graph.setData(graphData);
        if (usesLayoutSnapshot) {
          if (hasRenderedRef.current) await graph.draw();
          else await graph.render();
          if (!isCurrentRender()) return;
        } else {
          if (!layout) return;
          graph.setLayout(layout);
          await graph.render();
          if (!isCurrentRender()) return;
        }

        hasRenderedRef.current = true;
        renderedLayoutModeRef.current = layoutMode;

        const selectedId = selectedElementIdRef.current;
        if (
          selectedId
          && hasGraphElement(graphData, selectedId)
          && !isElementSelected(graph, selectedId)
        ) {
          await graph.setElementState(
            getControlledSelectionStateMap(graph, graphData, selectedId),
            false,
          );
          if (!isCurrentRender()) return;
        }

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
          if (snapshot) {
            lastEmittedLayoutSnapshotRef.current = snapshot;
            callbacksRef.current.onLayoutSnapshotChange?.(snapshot);
          }
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
  }, [graphData, layout, layoutMode, usesLayoutSnapshot]);

  useEffect(() => {
    const previousSelectedId = previousSelectedElementIdRef.current;
    previousSelectedElementIdRef.current = selectedElementId;

    const pendingNativeSelection = pendingNativeSelectionRef.current;
    if (
      pendingNativeSelection !== NO_NATIVE_SELECTION
      && pendingNativeSelection === selectedElementId
    ) {
      pendingNativeSelectionRef.current = NO_NATIVE_SELECTION;
      return;
    }
    pendingNativeSelectionRef.current = NO_NATIVE_SELECTION;
    if (previousSelectedId === selectedElementId) return;

    const graph = graphRef.current;
    if (
      !graph
      || graph.destroyed
      || completedRenderRevisionRef.current !== renderRevisionRef.current
    ) {
      return;
    }

    void graph.setElementState(
      getControlledSelectionStateMap(graph, graphDataRef.current, selectedElementId),
      false,
    )
      .catch((error) => {
        if (!graph.destroyed && graphRef.current === graph) {
          console.error("[OntologyViz] Failed to update element state", error);
        }
      });
  }, [selectedElementId]);

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
