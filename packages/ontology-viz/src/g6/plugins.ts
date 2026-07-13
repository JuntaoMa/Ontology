import type { Graph, GraphOptions } from "@antv/g6";

import {
  getOntologyCompactIRI,
  getOntologyDefaultDescription,
  getOntologyDefaultLabel,
  type OntologyEdge,
  type OntologyEntity,
} from "../core";

type G6PluginOptions = NonNullable<GraphOptions["plugins"]>;
type G6PluginOption = G6PluginOptions[number];

interface TooltipDatum {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  data?: Record<string, unknown>;
}

function asTooltipDatum(value: unknown): TooltipDatum | undefined {
  return value && typeof value === "object" ? value as TooltipDatum : undefined;
}

function getEntity(value: unknown): OntologyEntity | undefined {
  const datum = asTooltipDatum(value);
  const entity = datum?.data?.entity;
  return entity && typeof entity === "object" ? entity as OntologyEntity : undefined;
}

function getEdge(value: unknown): OntologyEdge | undefined {
  const datum = asTooltipDatum(value);
  const edge = datum?.data?.edge;
  return edge && typeof edge === "object" ? edge as OntologyEdge : undefined;
}

function appendTooltipRow(
  container: HTMLElement,
  label: string,
  value?: string,
  wrap = false,
) {
  if (!value) return;
  const row = document.createElement("div");
  row.className = "ontology-viz-tooltip__row";

  const labelElement = document.createElement("span");
  labelElement.className = "ontology-viz-tooltip__label";
  labelElement.textContent = label;

  const valueElement = document.createElement("span");
  valueElement.className = "ontology-viz-tooltip__value";
  if (wrap) valueElement.classList.add("ontology-viz-tooltip__value--wrap");
  valueElement.textContent = value;

  row.append(labelElement, valueElement);
  container.append(row);
}

function createTooltipShell(title: string, type: string) {
  const container = document.createElement("div");
  container.className = "ontology-viz-tooltip";

  const titleElement = document.createElement("div");
  titleElement.className = "ontology-viz-tooltip__title";
  titleElement.textContent = title;

  const typeElement = document.createElement("div");
  typeElement.className = "ontology-viz-tooltip__type";
  typeElement.textContent = type;

  container.append(titleElement, typeElement);
  return container;
}

function createTooltipContent(item: unknown) {
  const entity = getEntity(item);
  if (entity) {
    const container = createTooltipShell(getOntologyDefaultLabel(entity), entity.kind);
    appendTooltipRow(container, "Local", entity.localName);
    appendTooltipRow(container, "IRI", getOntologyCompactIRI(entity.iri));
    appendTooltipRow(container, "Namespace", entity.namespace);
    appendTooltipRow(
      container,
      "Description",
      getOntologyDefaultDescription(entity),
      true,
    );
    return container;
  }

  const edge = getEdge(item);
  if (edge) {
    const container = createTooltipShell(edge.label, edge.kind);
    appendTooltipRow(container, "Source", getOntologyCompactIRI(edge.source));
    appendTooltipRow(container, "Target", getOntologyCompactIRI(edge.target));
    appendTooltipRow(
      container,
      "Property",
      edge.propertyIRI ? getOntologyCompactIRI(edge.propertyIRI) : undefined,
    );
    return container;
  }

  return "";
}

export function createG6MinimapPlugin(): G6PluginOption {
  return {
    type: "minimap",
    key: "ontology-minimap",
    size: [180, 120],
    padding: 8,
    position: "right-bottom",
    delay: 128,
  };
}

export function createG6TooltipPlugin(): G6PluginOption {
  return {
    type: "tooltip",
    key: "ontology-tooltip",
    trigger: "hover",
    offset: [10, 10],
    enterable: false,
    onOpenChange: () => undefined,
    getContent: async (_event: unknown, items: unknown[]) => createTooltipContent(items[0]),
  };
}

export function createG6FullscreenPlugin(): G6PluginOption {
  return {
    type: "fullscreen",
    key: "ontology-fullscreen",
    autoFit: false,
  };
}

export function createG6ToolbarPlugin(): G6PluginOption {
  return function ontologyToolbar(this: Graph) {
    const graph = this;

    return {
      type: "toolbar",
      key: "ontology-toolbar",
      className: "ontology-viz-toolbar",
      position: "top-left",
      getItems: () => [
        { id: "zoom-in", value: "zoom-in", title: "放大" },
        { id: "zoom-out", value: "zoom-out", title: "缩小" },
        { id: "auto-fit", value: "fit-view", title: "适应画布" },
        { id: "export", value: "export", title: "导出图片" },
        { id: "request-fullscreen", value: "fullscreen", title: "全屏" },
      ],
      onClick: (value: string) => {
        if (value === "zoom-in") {
          void graph.zoomBy(1.2);
          return;
        }
        if (value === "zoom-out") {
          void graph.zoomBy(0.8);
          return;
        }
        if (value === "fit-view") {
          void graph.fitView();
          return;
        }
        if (value === "export") {
          void graph.toDataURL().then((url) => {
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "ontology-graph.png";
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
          });
          return;
        }
        if (value === "fullscreen") {
          const fullscreen = graph.getPluginInstance("ontology-fullscreen") as unknown as {
            request: () => void;
            exit: () => void;
          };
          if (document.fullscreenElement) fullscreen.exit();
          else fullscreen.request();
        }
      },
    };
  };
}

export function createG6FisheyePlugin(): G6PluginOption {
  return {
    type: "fisheye",
    key: "ontology-fisheye",
    trigger: "click",
    r: 160,
    d: 1.5,
    showDPercent: false,
    preventDefault: false,
    style: {
      fill: "#dbeafe",
      fillOpacity: 0.08,
      stroke: "#2563eb",
      strokeOpacity: 0.4,
      lineWidth: 1,
    },
    nodeStyle: { label: true },
  };
}

export function createG6StandalonePlugins(): G6PluginOptions {
  return [
    createG6TooltipPlugin(),
    createG6FullscreenPlugin(),
    createG6ToolbarPlugin(),
  ];
}
