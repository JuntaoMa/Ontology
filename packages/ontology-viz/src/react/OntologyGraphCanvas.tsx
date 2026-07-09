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

export function OntologyGraphCanvas({
  data,
  adapterOptions,
  layoutMode = "force-atlas2",
  className,
  style,
  behaviors = DEFAULT_BEHAVIORS,
  plugins,
  focusedElementId,
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
