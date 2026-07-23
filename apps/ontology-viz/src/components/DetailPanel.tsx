import type { ReactNode } from "react";

import {
  DESCRIPTION_PREDICATES,
  LABEL_PREDICATES,
  localName,
  type OntologyDocument,
  type OntologyResource,
  type OntologyValue,
  type PropertyAssociation,
  type PropertyKind,
} from "../ontology";
import { RESOURCE_COLORS, RESOURCE_LABELS } from "../graph";
import { DataTable, type DataTableRow } from "./DataTable";

export interface DetailPanelProps {
  document: OntologyDocument;
  selectedId?: string;
  onClose: () => void;
}

function Badge({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="value-badge" style={color ? { backgroundColor: color } : undefined}>
      {children}
    </span>
  );
}

function identity(label: string, iri: string) {
  return (
    <span className="table-identity">
      <strong>{label}</strong>
      <Badge>{iri}</Badge>
    </span>
  );
}

function displayValue(document: OntologyDocument, value: OntologyValue) {
  if (value.kind === "literal") return value.value;
  return document.indexes.resourceById.get(value.id)?.label || localName(value.id);
}

function rangeBadges(document: OntologyDocument, resource: OntologyResource) {
  return resource.ranges.map((range) => {
    const target = document.indexes.resourceById.get(range);
    const label = target?.label || localName(range);
    const kind = target?.kind ?? "External";
    return (
      <Badge key={range} color={RESOURCE_COLORS[kind]}>
        {label}
      </Badge>
    );
  });
}

function associationValue(
  document: OntologyDocument,
  property: OntologyResource,
  association: PropertyAssociation,
) {
  return (
    <span className="value-list">
      {association.values.map((value, index) => (
        <span key={`${association.propertyId}-value-${index}`}>
          {displayValue(document, value)}
        </span>
      ))}
      {rangeBadges(document, property)}
      {!association.values.length && !property.ranges.length ? "—" : null}
    </span>
  );
}

function restrictionText(
  document: OntologyDocument,
  association: PropertyAssociation,
) {
  const values = association.restrictions.flatMap((restriction) => (
    restriction.conditions.map((condition) => (
      `${condition.operator} ${displayValue(document, condition.value)}`
    ))
  ));
  return values.length ? values.join("; ") : "—";
}

function propertyRows(
  document: OntologyDocument,
  associations: PropertyAssociation[],
): DataTableRow[] {
  return associations.flatMap((association) => {
    const property = document.indexes.resourceById.get(association.propertyId);
    if (!property) return [];
    return [{
      id: property.id,
      cells: {
        property: identity(property.label, property.compactIri),
        description: property.description || "—",
        value: associationValue(document, property, association),
        traits: property.traits.length ? property.traits.join(", ") : "—",
        restriction: restrictionText(document, association),
      },
    }];
  });
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="detail-section">
      <h3>
        {title}
        {count !== undefined ? <span> · {count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function basicRows(resource: OntologyResource): DataTableRow[] {
  const rows: DataTableRow[] = [];
  const descriptions = new Map<string, string[]>();
  for (const entry of resource.annotations) {
    const predicateName = localName(entry.predicate);
    if (
      !DESCRIPTION_PREDICATES.has(entry.predicate)
      && !["comment", "definition", "description"].includes(predicateName.toLowerCase())
    ) {
      continue;
    }
    const field = `${predicateName}${entry.language ? `@${entry.language}` : ""}`;
    const values = descriptions.get(field) ?? [];
    values.push(entry.value);
    descriptions.set(field, values);
  }
  for (const [field, values] of descriptions) {
    rows.push({
      id: `description-${field}`,
      cells: { field, value: values.join("; ") },
    });
  }
  rows.push({
    id: "iri",
    cells: { field: "IRI", value: resource.iri },
  });
  const labels = new Map<string, string[]>();
  for (const entry of resource.labels) {
    const field = `label${entry.language ? `@${entry.language}` : ""}`;
    const values = labels.get(field) ?? [];
    values.push(entry.value);
    labels.set(field, values);
  }
  for (const [field, values] of labels) {
    rows.push({
      id: `label-${field}`,
      cells: { field, value: values.join("; ") },
    });
  }
  return rows;
}

function relationRows(
  document: OntologyDocument,
  resource: OntologyResource,
  direction: "incoming" | "outgoing",
) {
  const edges = direction === "incoming"
    ? document.indexes.incomingById.get(resource.id) ?? []
    : document.indexes.outgoingById.get(resource.id) ?? [];
  return edges.map((edge) => {
    const otherId = direction === "incoming" ? edge.source : edge.target;
    const other = document.indexes.resourceById.get(otherId);
    return {
      id: `${direction}-${edge.id}`,
      cells: {
        relation: identity(edge.label, edge.predicateIri),
        endpoint: identity(other?.label || localName(otherId), other?.compactIri || otherId),
      },
    };
  });
}

function otherRows(document: OntologyDocument, resource: OntologyResource) {
  const propertyIds = new Set(resource.properties.map((property) => property.propertyId));
  return resource.annotations
    .filter((entry) => (
      !LABEL_PREDICATES.has(entry.predicate)
      && !DESCRIPTION_PREDICATES.has(entry.predicate)
      && !["comment", "definition", "description"].includes(
        localName(entry.predicate).toLowerCase(),
      )
      && !propertyIds.has(entry.predicate)
    ))
    .map((entry, index) => ({
      id: `annotation-${index}`,
      cells: {
        field: localName(entry.predicate),
        value: `${entry.value}${entry.language ? `@${entry.language}` : ""}`,
      },
    }));
}

function ResourceDetail({
  document,
  resource,
}: {
  document: OntologyDocument;
  resource: OntologyResource;
}) {
  const propertyColumns = [
    { key: "property", label: "属性", width: "180px" },
    { key: "description", label: "说明", width: "260px" },
    { key: "value", label: "值 / 范围", width: "220px" },
    { key: "traits", label: "特征", width: "120px" },
    { key: "restriction", label: "限制", width: "180px" },
  ];
  const byKind = (kind: PropertyKind) => resource.properties.filter((association) => (
    document.indexes.resourceById.get(association.propertyId)?.kind === kind
  ));
  const propertySections: Array<[PropertyKind, string]> = [
    ["ObjectProperty", "Object Property"],
    ["DatatypeProperty", "Datatype Property"],
    ["AnnotationProperty", "Annotation Property"],
  ];
  const outgoing = relationRows(document, resource, "outgoing");
  const incoming = relationRows(document, resource, "incoming");
  const other = otherRows(document, resource);

  return (
    <>
      <Section title="基本信息">
        <DataTable
          columns={[
            { key: "field", label: "字段", width: "160px" },
            { key: "value", label: "值", width: "360px" },
          ]}
          rows={basicRows(resource)}
        />
      </Section>
      {propertySections.map(([kind, title]) => {
        const associations = byKind(kind);
        if (!associations.length) return null;
        return (
          <Section key={kind} title={title} count={associations.length}>
            <DataTable columns={propertyColumns} rows={propertyRows(document, associations)} />
          </Section>
        );
      })}
      {outgoing.length ? (
        <Section title="出向关系" count={outgoing.length}>
          <DataTable
            columns={[
              { key: "relation", label: "关系", width: "200px" },
              { key: "endpoint", label: "目标", width: "240px" },
            ]}
            rows={outgoing}
          />
        </Section>
      ) : null}
      {incoming.length ? (
        <Section title="入向关系" count={incoming.length}>
          <DataTable
            columns={[
              { key: "relation", label: "关系", width: "200px" },
              { key: "endpoint", label: "来源", width: "240px" },
            ]}
            rows={incoming}
          />
        </Section>
      ) : null}
      {other.length ? (
        <Section title="其他信息">
          <DataTable
            columns={[
              { key: "field", label: "字段", width: "160px" },
              { key: "value", label: "值", width: "360px" },
            ]}
            rows={other}
          />
        </Section>
      ) : null}
    </>
  );
}

function EdgeDetail({
  document,
  edgeId,
}: {
  document: OntologyDocument;
  edgeId: string;
}) {
  const edge = document.indexes.edgeById.get(edgeId)!;
  const source = document.indexes.resourceById.get(edge.source);
  const target = document.indexes.resourceById.get(edge.target);
  return (
    <Section title="关系信息">
      <DataTable
        columns={[
          { key: "field", label: "字段", width: "140px" },
          { key: "value", label: "值", width: "380px" },
        ]}
        rows={[
          { id: "predicate", cells: { field: "Predicate", value: edge.predicateIri } },
          {
            id: "source",
            cells: {
              field: "Source",
              value: identity(source?.label || edge.source, source?.compactIri || edge.source),
            },
          },
          {
            id: "target",
            cells: {
              field: "Target",
              value: identity(target?.label || edge.target, target?.compactIri || edge.target),
            },
          },
          { id: "description", cells: { field: "Description", value: edge.description || "—" } },
        ]}
      />
    </Section>
  );
}

export function DetailPanel({ document, selectedId, onClose }: DetailPanelProps) {
  if (!selectedId) return null;
  const resource = document.indexes.resourceById.get(selectedId);
  const edge = document.indexes.edgeById.get(selectedId);
  if (!resource && !edge) return null;
  const title = resource?.label || edge?.label || "";
  const type = resource ? RESOURCE_LABELS[resource.kind] : "Relation";
  const color = resource ? RESOURCE_COLORS[resource.kind] : edge!.color;

  return (
    <aside className="detail-panel" aria-label="本体详情">
      <header className="detail-panel__header">
        <div className="detail-panel__title">
          <h2>{title}</h2>
          <span className="type-badge" style={{ backgroundColor: color }}>{type}</span>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭详情">
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="detail-panel__body">
        {resource
          ? <ResourceDetail document={document} resource={resource} />
          : <EdgeDetail document={document} edgeId={edge!.id} />}
      </div>
    </aside>
  );
}
