import type { OntologyDocument } from "../ontology";
import { RESOURCE_COLORS, RESOURCE_LABELS } from "../graph";

interface TooltipDatum {
  id?: unknown;
  data?: Record<string, unknown>;
}

function appendRow(container: HTMLElement, label: string, value?: string, wrap = false) {
  if (!value) return;
  const row = document.createElement("div");
  row.className = "graph-tooltip__row";
  const key = document.createElement("span");
  key.className = "graph-tooltip__key";
  key.textContent = label;
  const content = document.createElement("span");
  content.className = `graph-tooltip__value${wrap ? " graph-tooltip__value--wrap" : ""}`;
  content.textContent = value;
  row.append(key, content);
  container.append(row);
}

function heading(title: string, type: string, color: string) {
  const container = document.createElement("div");
  container.className = "graph-tooltip";
  const titleRow = document.createElement("div");
  titleRow.className = "graph-tooltip__heading";
  const titleElement = document.createElement("strong");
  titleElement.className = "graph-tooltip__title";
  titleElement.textContent = title;
  const badge = document.createElement("span");
  badge.className = "type-badge";
  badge.style.backgroundColor = color;
  badge.textContent = type;
  titleRow.append(titleElement, badge);
  container.append(titleRow);
  return container;
}

function propertyNames(document: OntologyDocument, resourceId: string) {
  const resource = document.indexes.resourceById.get(resourceId);
  if (!resource) return "";
  const labels = resource.properties.flatMap((association) => {
    const property = document.indexes.resourceById.get(association.propertyId);
    return property ? [property.label] : [];
  });
  const visible = labels.slice(0, 6);
  return `${visible.join(", ")}${labels.length > visible.length ? ` +${labels.length - visible.length}` : ""}`;
}

export function createTooltip(document: OntologyDocument, value: unknown) {
  const datum = value && typeof value === "object" ? value as TooltipDatum : undefined;
  const id = datum?.id === undefined ? "" : String(datum.id);
  const resource = document.indexes.resourceById.get(id);
  if (resource) {
    const container = heading(
      resource.label,
      RESOURCE_LABELS[resource.kind],
      RESOURCE_COLORS[resource.kind],
    );
    appendRow(container, "IRI", resource.compactIri);
    appendRow(container, "属性", propertyNames(document, resource.id));
    appendRow(container, "说明", resource.description, true);
    return container;
  }

  const edge = document.indexes.edgeById.get(id);
  if (!edge) return "";
  const source = document.indexes.resourceById.get(edge.source);
  const target = document.indexes.resourceById.get(edge.target);
  const container = heading(edge.label, "Relation", edge.color);
  appendRow(container, "关系", edge.predicateIri);
  appendRow(container, "源", source?.label || edge.source);
  appendRow(container, "目标", target?.label || edge.target);
  appendRow(container, "说明", edge.description, true);
  return container;
}
