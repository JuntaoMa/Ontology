import type { GraphOptions } from "@antv/g6";

import { getOntologyDefaultLabel, type OntologyEdge, type OntologyEntity } from "../core";

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

function appendTooltipRow(container: HTMLElement, label: string, value?: string) {
  if (!value) return;
  const row = document.createElement("div");
  row.className = "ontology-viz-tooltip__row";

  const labelElement = document.createElement("span");
  labelElement.className = "ontology-viz-tooltip__label";
  labelElement.textContent = label;

  const valueElement = document.createElement("span");
  valueElement.className = "ontology-viz-tooltip__value";
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
    appendTooltipRow(container, "IRI", entity.iri);
    return container;
  }

  const edge = getEdge(item);
  if (edge) {
    const container = createTooltipShell(edge.label, edge.kind);
    appendTooltipRow(container, "Source", edge.source);
    appendTooltipRow(container, "Target", edge.target);
    appendTooltipRow(container, "Property", edge.propertyIRI);
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

export function createG6StandalonePlugins(): G6PluginOptions {
  return [
    createG6TooltipPlugin(),
    createG6MinimapPlugin(),
  ];
}
