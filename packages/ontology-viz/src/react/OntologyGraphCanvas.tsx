import { CanvasEvent, EdgeEvent, Graph, NodeEvent, type GraphData, type GraphOptions } from "@antv/g6";
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";

import type { OntologyGraphData } from "../core";
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
  focusedElementId?: string;
  selectedElementId?: string;
  onNodeSelect?: (id: string) => void;
  onEdgeSelect?: (id: string) => void;
  onCanvasClick?: () => void;
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

export function OntologyGraphCanvas({
  data,
  adapterOptions,
  layoutMode = "force-atlas2",
  className,
  style,
  behaviors = DEFAULT_BEHAVIORS,
  plugins,
  focusedElementId,
  selectedElementId,
  onNodeSelect,
  onEdgeSelect,
  onCanvasClick,
  onGraphReady,
}: OntologyGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const callbacksRef = useRef({
    onNodeSelect,
    onEdgeSelect,
    onCanvasClick,
    onGraphReady,
  });

  callbacksRef.current = {
    onNodeSelect,
    onEdgeSelect,
    onCanvasClick,
    onGraphReady,
  };

  const graphData = useMemo<GraphData>(
    () => toG6GraphData(data, adapterOptions),
    [adapterOptions, data],
  );
  const layout = useMemo<NonNullable<GraphOptions["layout"]>>(
    () => createG6LayoutOptions(layoutMode, adapterOptions?.nodeSize) as NonNullable<GraphOptions["layout"]>,
    [adapterOptions?.nodeSize, layoutMode],
  );

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

    callbacksRef.current.onGraphReady?.(graph);

    return () => {
      graph.destroy();
      graphRef.current = null;
    };
  }, [behaviors, plugins]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    graph.setData(graphData);
    graph.setLayout(layout);
    void graph.render();
  }, [behaviors, graphData, layout, plugins]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    void graph.setElementState(getElementStateMap(graphData, selectedElementId), false);
  }, [graphData, selectedElementId]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !focusedElementId) return;

    void graph.focusElement(focusedElementId, {
      duration: 300,
      easing: "ease-in-out",
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
