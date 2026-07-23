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
} from "react";

import { createTooltip } from "../components/createTooltip";
import {
  createLayout,
  PERFORMANCE_LIMITS,
  toGraphData,
} from ".";
import type { GraphCanvasProps, LayoutSnapshot } from "./types";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const INITIAL_MAX_ZOOM = 1.6;
const LABEL_ZOOM_RATIOS = [1.5, 2.5, 4];

function withLayoutSnapshot(data: GraphData, snapshot?: LayoutSnapshot) {
  if (!snapshot) return data;
  return {
    ...data,
    nodes: data.nodes?.map((node) => {
      const position = snapshot.nodes[String(node.id)];
      if (!position) return node;
      return {
        ...node,
        style: { ...node.style, ...position },
      };
    }),
  };
}

function hasCompleteSnapshot(data: GraphData, snapshot?: LayoutSnapshot) {
  return Boolean(
    snapshot
    && data.nodes?.length
    && data.nodes.every((node) => snapshot.nodes[String(node.id)]),
  );
}

function readLayoutSnapshot(graph: Graph): LayoutSnapshot | undefined {
  const nodes: LayoutSnapshot["nodes"] = {};
  for (const node of graph.getNodeData()) {
    try {
      const [x, y, z] = Array.from(graph.getElementPosition(String(node.id)));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      nodes[String(node.id)] = Number.isFinite(z) ? { x, y, z } : { x, y };
    } catch {
      // An element may have been removed while a layout is completing.
    }
  }
  return Object.keys(nodes).length ? { nodes, updatedAt: Date.now() } : undefined;
}

const CONTROLLED_STATES = new Set(["selected", "related", "inactive"]);

function selectionStates(
  graph: Graph,
  document: GraphCanvasProps["document"],
  selectedId?: string,
) {
  const states: Record<string, string[]> = {};
  const nodeIds = new Set(document.graph.nodeIds);
  const edgeIds = new Set(document.graph.edges.map((edge) => edge.id));
  const dimUnrelated = (
    nodeIds.size + edgeIds.size <= PERFORMANCE_LIMITS.dimUnrelated
  );

  const currentStates = (id: string) => {
    try {
      return graph.getElementState(id).filter((state) => !CONTROLLED_STATES.has(state));
    } catch {
      return [];
    }
  };

  if (dimUnrelated && selectedId) {
    for (const id of nodeIds) states[id] = [...currentStates(id), "inactive"];
    for (const id of edgeIds) states[id] = [...currentStates(id), "inactive"];
  } else {
    for (const state of CONTROLLED_STATES) {
      for (const datum of [
        ...graph.getElementDataByState("node", state),
        ...graph.getElementDataByState("edge", state),
      ]) {
        const id = String(datum.id);
        if (!states[id]) states[id] = currentStates(id);
      }
    }
  }

  if (!selectedId) return states;
  const setState = (id: string, state: string) => {
    states[id] = [...currentStates(id), state];
  };

  if (nodeIds.has(selectedId)) {
    setState(selectedId, "selected");
    for (const edge of [
      ...(document.indexes.outgoingById.get(selectedId) ?? []),
      ...(document.indexes.incomingById.get(selectedId) ?? []),
    ]) {
      setState(edge.id, "related");
      const neighborId: string = edge.source === selectedId ? edge.target : edge.source;
      if (neighborId !== selectedId) setState(neighborId, "related");
    }
  } else if (edgeIds.has(selectedId)) {
    const edge = document.indexes.edgeById.get(selectedId);
    if (edge) {
      setState(edge.id, "selected");
      setState(edge.source, "related");
      setState(edge.target, "related");
    }
  }
  return states;
}

export function GraphCanvas({
  document,
  layoutMode,
  layoutSnapshot,
  selectedElementId,
  onNodeSelect,
  onEdgeSelect,
  onCanvasClick,
  onOpenSettings,
  onBusyChange,
  onLayoutSnapshotChange,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const documentRef = useRef(document);
  const callbacksRef = useRef({
    onNodeSelect,
    onEdgeSelect,
    onCanvasClick,
    onOpenSettings,
    onBusyChange,
    onLayoutSnapshotChange,
  });
  const currentSourceRef = useRef<string | undefined>(undefined);
  const currentLayoutRef = useRef(layoutMode);
  const renderRevisionRef = useRef(0);
  const renderedRef = useRef(false);
  const labelReferenceZoomRef = useRef(1);
  const fixedNodeZoomRef = useRef(1);
  const labelTierRef = useRef(-1);

  documentRef.current = document;
  callbacksRef.current = {
    onNodeSelect,
    onEdgeSelect,
    onCanvasClick,
    onOpenSettings,
    onBusyChange,
    onLayoutSnapshotChange,
  };

  const graphData = useMemo(() => toGraphData(document), [document]);

  const syncLabelsForZoom = async (graph: Graph) => {
    if (graph.destroyed) return;
    const ratio = graph.getZoom() / Math.max(labelReferenceZoomRef.current, 0.001);
    const tier = ratio >= LABEL_ZOOM_RATIOS[2]
      ? 3
      : ratio >= LABEL_ZOOM_RATIOS[1]
        ? 2
        : ratio >= LABEL_ZOOM_RATIOS[0]
          ? 1
          : 0;
    if (tier === labelTierRef.current) return;
    labelTierRef.current = tier;
    const updates = graph.getNodeData().flatMap((node) => {
      const visible = Number(node.data?.labelLevel ?? 3) <= tier;
      const labelText = visible ? String(node.data?.label ?? "") : "";
      if ((node.style?.labelText || "") === labelText) return [];
      return [{ id: node.id, style: { labelText } }];
    });
    if (!updates.length) return;
    graph.updateNodeData(updates);
    await graph.draw();
  };

  const initializeViewport = async (graph: Graph) => {
    await graph.fitView();
    const fittedZoom = graph.getZoom();
    const zoom = Math.min(INITIAL_MAX_ZOOM, Math.max(MIN_ZOOM, fittedZoom));
    if (Math.abs(zoom - fittedZoom) > 0.001) await graph.zoomTo(zoom, false);
    await graph.fitCenter();
    labelReferenceZoomRef.current = zoom;
    fixedNodeZoomRef.current = Math.max(1, zoom);
    labelTierRef.current = -1;
    await syncLabelsForZoom(graph);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    currentSourceRef.current = undefined;
    currentLayoutRef.current = layoutMode;
    renderedRef.current = false;
    labelTierRef.current = -1;

    const toolbar = function toolbarPlugin(this: Graph) {
      const graph = this;
      return {
        type: "toolbar",
        key: "ontology-toolbar",
        position: "top-left",
        getItems: () => [
          { id: "zoom-in", value: "zoom-in", title: "放大" },
          { id: "zoom-out", value: "zoom-out", title: "缩小" },
          { id: "export", value: "export", title: "导出图片" },
          { id: "request-fullscreen", value: "fullscreen", title: "全屏" },
          { id: "ontology-settings", value: "settings", title: "布局设置" },
        ],
        onClick: async (value: string) => {
          if (value === "zoom-in") {
            await graph.zoomBy(1.2);
            await syncLabelsForZoom(graph);
          } else if (value === "zoom-out") {
            await graph.zoomBy(0.8);
            await syncLabelsForZoom(graph);
          } else if (value === "export") {
            const url = await graph.toDataURL();
            const anchor = window.document.createElement("a");
            anchor.href = url;
            anchor.download = `${documentRef.current.source.name}.png`;
            window.document.body.append(anchor);
            anchor.click();
            anchor.remove();
          } else if (value === "fullscreen") {
            const fullscreen = graph.getPluginInstance("ontology-fullscreen") as unknown as {
              request: () => void;
              exit: () => void;
            };
            if (window.document.fullscreenElement) fullscreen.exit();
            else fullscreen.request();
          } else if (value === "settings") {
            callbacksRef.current.onOpenSettings();
          }
        },
      };
    };

    const graph = new Graph({
      container,
      animation: false,
      autoResize: true,
      zoomRange: [MIN_ZOOM, MAX_ZOOM],
      behaviors: [
        "drag-canvas",
        {
          type: "zoom-canvas",
          key: "ontology-zoom",
          enable: (event: unknown) => Boolean((event as { ctrlKey?: boolean }).ctrlKey),
          sensitivity: 0.8,
          onFinish: () => void syncLabelsForZoom(graph),
        },
        {
          type: "scroll-canvas",
          key: "ontology-scroll",
          enable: (event: unknown) => !(event as { ctrlKey?: boolean }).ctrlKey,
        },
        {
          type: "fix-element-size",
          key: "ontology-fix-node-size",
          enable: (event: IViewportEvent) => (
            (event.data?.scale ?? 1) > 1
            && graph.getZoom() >= fixedNodeZoomRef.current
          ),
          node: [{ shape: "key" }],
          edgeFilter: () => false,
          comboFilter: () => false,
          reset: true,
        },
        "drag-element",
        {
          type: "hover-activate",
          key: "ontology-hover",
          degree: 0,
          state: "hovered",
          animation: false,
        },
        {
          type: "click-select",
          key: "ontology-select",
          degree: 1,
          state: "selected",
          neighborState: "related",
          animation: false,
        },
        {
          type: "optimize-viewport-transform",
          key: "ontology-optimize-viewport",
          shapes: { node: ["key"] },
        },
      ],
      plugins: [
        {
          type: "legend",
          key: "ontology-legend",
          nodeField: "legend",
          edgeField: "legend",
          position: "bottom-left",
          orientation: "vertical",
          layout: "flex",
          gridCol: 1,
          gridRow: 24,
          width: 180,
          height: 220,
          padding: [8, 10, 8, 10],
          itemMarkerSize: 9,
          itemLabelFontSize: 10,
          rowPadding: 4,
          colPadding: 0,
          containerStyle: {
            border: "1px solid rgba(207, 215, 224, 0.92)",
            borderRadius: "6px",
            background: "rgba(255, 255, 255, 0.9)",
          },
        },
        {
          type: "minimap",
          key: "ontology-minimap",
          size: [180, 120],
          position: "right-bottom",
          shape: "key",
          delay: PERFORMANCE_LIMITS.minimapDelay,
          filter: (_id: string, type: string) => type === "node",
          containerStyle: {
            border: "1px solid rgba(207, 215, 224, 0.92)",
            borderRadius: "6px",
            background: "rgba(255, 255, 255, 0.9)",
          },
        },
        {
          type: "tooltip",
          key: "ontology-tooltip",
          trigger: "hover",
          offset: [10, 10],
          enterable: false,
          style: {
            ".tooltip": {
              padding: "0",
              "min-width": "0",
              "max-width": "none",
              width: "max-content",
              "background-color": "transparent",
              "box-shadow": "none",
              "border-radius": "0",
              "z-index": "80",
            },
          },
          getContent: async (_event: unknown, items: unknown[]) => (
            createTooltip(documentRef.current, items[0])
          ),
        },
        { type: "fullscreen", key: "ontology-fullscreen", autoFit: false },
        toolbar,
      ],
      node: {
        state: {
          hovered: {
            lineWidth: 2.5,
            stroke: "#365f78",
            labelText: (node) => String(node.data?.label ?? ""),
            labelOpacity: 1,
          },
          selected: {
            lineWidth: 3,
            stroke: "#284f68",
            halo: true,
            haloStroke: "#55758a",
            haloStrokeOpacity: 0.28,
            labelText: (node) => String(node.data?.label ?? ""),
            labelOpacity: 1,
          },
          related: {
            lineWidth: 2,
            stroke: "#55758a",
            fillOpacity: 1,
            labelText: (node) => String(node.data?.label ?? ""),
            labelOpacity: 1,
          },
          inactive: {
            fillOpacity: 0.12,
            strokeOpacity: 0.1,
            labelOpacity: 0.06,
          },
        },
      },
      edge: {
        state: {
          hovered: { lineWidth: 2.2, stroke: "#365f78", strokeOpacity: 1 },
          selected: { lineWidth: 2.5, stroke: "#284f68", strokeOpacity: 1 },
          related: { lineWidth: 1.8, stroke: "#55758a", strokeOpacity: 0.9 },
          inactive: { strokeOpacity: 0.04 },
        },
      },
    });

    graphRef.current = graph;
    graph.on(NodeEvent.CLICK, (event) => {
      const target = (
        "target" in event ? event.target : undefined
      ) as { id?: unknown } | undefined;
      if (target?.id !== undefined) {
        callbacksRef.current.onNodeSelect(String(target.id));
      }
    });
    graph.on(EdgeEvent.CLICK, (event) => {
      const target = (
        "target" in event ? event.target : undefined
      ) as { id?: unknown } | undefined;
      if (target?.id !== undefined) {
        callbacksRef.current.onEdgeSelect(String(target.id));
      }
    });
    graph.on(CanvasEvent.CLICK, () => callbacksRef.current.onCanvasClick());
    graph.on(NodeEvent.DRAG_END, () => {
      const snapshot = readLayoutSnapshot(graph);
      if (snapshot) callbacksRef.current.onLayoutSnapshotChange?.(snapshot);
    });

    return () => {
      renderRevisionRef.current += 1;
      renderedRef.current = false;
      graphRef.current = null;
      graph.destroy();
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const revision = renderRevisionRef.current + 1;
    renderRevisionRef.current = revision;
    let cancelled = false;
    const isCurrent = () => (
      !cancelled
      && !graph.destroyed
      && graphRef.current === graph
      && renderRevisionRef.current === revision
    );

    void (async () => {
      const sourceChanged = currentSourceRef.current !== document.source.key;
      const layoutChanged = currentLayoutRef.current !== layoutMode;
      const usesSnapshot = sourceChanged && hasCompleteSnapshot(graphData, layoutSnapshot);

      if (sourceChanged) {
        currentSourceRef.current = document.source.key;
        currentLayoutRef.current = layoutMode;
        renderedRef.current = false;
        labelTierRef.current = -1;
        const dimUnrelated = (
          document.graph.nodeIds.length + document.graph.edges.length
          <= PERFORMANCE_LIMITS.dimUnrelated
        );
        graph.setBehaviors((behaviors) => behaviors.map((behavior) => {
          if (
            typeof behavior !== "object"
            || behavior === null
            || behavior.type !== "click-select"
          ) {
            return behavior;
          }
          return { ...behavior, unselectedState: dimUnrelated ? "inactive" : undefined };
        }));
        await graph.clear();
        if (!isCurrent()) return;
        graph.setData(usesSnapshot ? withLayoutSnapshot(graphData, layoutSnapshot) : graphData);
        callbacksRef.current.onBusyChange?.(
          usesSnapshot ? "" : `正在计算 ${layoutMode === "force-atlas2" ? "ForceAtlas2" : layoutMode}`,
        );
        if (usesSnapshot) {
          graph.setOptions({ layout: undefined } as GraphOptions);
          await graph.render();
        } else {
          graph.setLayout(createLayout(layoutMode, graphData.nodes?.length ?? 0)!);
          await graph.render();
        }
        if (!isCurrent()) return;
        renderedRef.current = true;
        await initializeViewport(graph);
        callbacksRef.current.onBusyChange?.("");
        if (!usesSnapshot) {
          const snapshot = readLayoutSnapshot(graph);
          if (snapshot) callbacksRef.current.onLayoutSnapshotChange?.(snapshot);
        }
        return;
      }

      if (layoutChanged) {
        currentLayoutRef.current = layoutMode;
        callbacksRef.current.onBusyChange?.(`正在应用 ${
          layoutMode === "force-atlas2" ? "ForceAtlas2" : layoutMode
        }`);
        graph.setLayout(createLayout(layoutMode, graphData.nodes?.length ?? 0)!);
        await graph.layout();
        if (!isCurrent()) return;
        await initializeViewport(graph);
        callbacksRef.current.onBusyChange?.("");
        const snapshot = readLayoutSnapshot(graph);
        if (snapshot) callbacksRef.current.onLayoutSnapshotChange?.(snapshot);
      }
    })().catch((error) => {
      if (!cancelled && isCurrent()) callbacksRef.current.onBusyChange?.("");
      if (!cancelled && !graph.destroyed && isCurrent()) {
        console.error("[OntologyViz] Graph update failed", error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [document.source.key, graphData, layoutMode, layoutSnapshot]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed || !renderedRef.current) return;
    void graph.setElementState(
      selectionStates(graph, document, selectedElementId),
      false,
    ).then(async () => {
      if (!selectedElementId || graph.destroyed) return;
      const nodeExists = graph.getNodeData().some((node) => String(node.id) === selectedElementId);
      const edgeExists = graph.getEdgeData().some((edge) => String(edge.id) === selectedElementId);
      if (!nodeExists && !edgeExists) return;
      await graph.focusElement(selectedElementId, {
        duration: 240,
        easing: "ease-in-out",
      });
    }).catch((error) => {
      if (!graph.destroyed) console.error("[OntologyViz] Selection update failed", error);
    });
  }, [document, selectedElementId]);

  return <div className="graph-stage"><div ref={containerRef} className="graph-canvas" /></div>;
}
