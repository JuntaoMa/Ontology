import { useMemo } from "react";

import {
  getOntologyCompactIRI,
  getOntologyDefaultDescription,
  getOntologyDefaultLabel,
  type OntologyEdge,
  type OntologyEntity,
  type OntologyGraphData,
  type OntologyValue,
} from "../core";

export type OntologyDetailItem =
  | { type: "entity"; entity: OntologyEntity }
  | { type: "edge"; edge: OntologyEdge };

export interface OntologyDetailPanelProps {
  item?: OntologyDetailItem;
  data?: OntologyGraphData;
  onClose?: () => void;
  onEntitySelect?: (id: string) => void;
}

interface EntityPropertyEntry {
  iri: string;
  kind: "Literal" | "IRI";
  values: OntologyValue[];
}

interface EntityRelation {
  edge: OntologyEdge;
  direction: "IN" | "OUT" | "SELF";
  neighbor?: OntologyEntity;
}

const PROPERTY_LIMIT = 14;
const RELATION_LIMIT = 24;
const VALUE_LIMIT = 3;

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="ontology-viz-detail__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function DetailSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="ontology-viz-detail__section">
      <h3>
        <span>{title}</span>
        {count !== undefined && <small>{count}</small>}
      </h3>
      {children}
    </section>
  );
}

function formatOntologyValue(value: OntologyValue) {
  const displayValue = value.termType === "iri"
    ? getOntologyCompactIRI(value.value)
    : value.value;
  return value.language ? `${displayValue} (${value.language})` : displayValue;
}

function getEntityProperties(entity: OntologyEntity): EntityPropertyEntry[] {
  return [
    ...Object.entries(entity.literalProperties).map(([iri, values]) => ({
      iri,
      kind: "Literal" as const,
      values,
    })),
    ...Object.entries(entity.iriProperties).map(([iri, values]) => ({
      iri,
      kind: "IRI" as const,
      values,
    })),
  ].sort((left, right) => (
    getOntologyCompactIRI(left.iri).localeCompare(getOntologyCompactIRI(right.iri))
  ));
}

function EntityProperties({ properties }: { properties: EntityPropertyEntry[] }) {
  const visibleProperties = properties.slice(0, PROPERTY_LIMIT);
  return (
    <div className="ontology-viz-detail__properties">
      {visibleProperties.map((property) => {
        const visibleValues = property.values.slice(0, VALUE_LIMIT).map(formatOntologyValue);
        const hiddenValueCount = property.values.length - visibleValues.length;
        return (
          <div className="ontology-viz-detail__property" key={`${property.kind}:${property.iri}`}>
            <div className="ontology-viz-detail__property-name">
              <strong>{getOntologyCompactIRI(property.iri)}</strong>
              <span>{property.kind}</span>
            </div>
            <p title={property.values.map(formatOntologyValue).join("\n")}>
              {visibleValues.join(", ")}
              {hiddenValueCount > 0 && ` +${hiddenValueCount}`}
            </p>
          </div>
        );
      })}
      {properties.length > visibleProperties.length && (
        <p className="ontology-viz-detail__more">
          +{properties.length - visibleProperties.length} more properties
        </p>
      )}
    </div>
  );
}

function EntityRelations({
  relations,
  onEntitySelect,
}: {
  relations: EntityRelation[];
  onEntitySelect?: (id: string) => void;
}) {
  const visibleRelations = relations.slice(0, RELATION_LIMIT);
  return (
    <div className="ontology-viz-detail__relations">
      {visibleRelations.map(({ edge, direction, neighbor }) => (
        <button
          className="ontology-viz-detail__relation"
          type="button"
          key={edge.id}
          disabled={!neighbor || !onEntitySelect}
          onClick={() => neighbor && onEntitySelect?.(neighbor.id)}
        >
          <span className={`ontology-viz-detail__direction ontology-viz-detail__direction--${direction.toLowerCase()}`}>
            {direction}
          </span>
          <span className="ontology-viz-detail__relation-copy">
            <strong>{edge.label}</strong>
            <span>{neighbor ? getOntologyDefaultLabel(neighbor) : "Unknown entity"}</span>
          </span>
          {neighbor && <small>{neighbor.kind}</small>}
        </button>
      ))}
      {relations.length > visibleRelations.length && (
        <p className="ontology-viz-detail__more">
          +{relations.length - visibleRelations.length} more relations
        </p>
      )}
    </div>
  );
}

function EntityDetail({
  entity,
  data,
  entityById,
  onEntitySelect,
}: {
  entity: OntologyEntity;
  data?: OntologyGraphData;
  entityById: Map<string, OntologyEntity>;
  onEntitySelect?: (id: string) => void;
}) {
  const description = getOntologyDefaultDescription(entity);
  const properties = getEntityProperties(entity);
  const relations: EntityRelation[] = (data?.edges ?? [])
    .filter((edge) => edge.source === entity.id || edge.target === entity.id)
    .map((edge) => {
      const self = edge.source === entity.id && edge.target === entity.id;
      const outgoing = edge.source === entity.id;
      const neighborId = self ? entity.id : outgoing ? edge.target : edge.source;
      const direction: EntityRelation["direction"] = self ? "SELF" : outgoing ? "OUT" : "IN";
      return {
        edge,
        direction,
        neighbor: entityById.get(neighborId),
      };
    })
    .sort((left, right) => (
      left.edge.label.localeCompare(right.edge.label)
      || getOntologyDefaultLabel(left.neighbor ?? entity)
        .localeCompare(getOntologyDefaultLabel(right.neighbor ?? entity))
    ));

  return (
    <>
      <div className="ontology-viz-detail__heading">
        <span>{entity.kind}</span>
        <h2>{getOntologyDefaultLabel(entity)}</h2>
        <p>{getOntologyCompactIRI(entity.iri)}</p>
      </div>
      <DetailSection title="Overview">
        <dl className="ontology-viz-detail__list">
          <DetailRow label="IRI" value={entity.iri} />
          <DetailRow label="Local name" value={entity.localName} />
          <DetailRow label="Namespace" value={entity.namespace} />
          <DetailRow label="Description" value={description} />
        </dl>
      </DetailSection>
      {properties.length > 0 && (
        <DetailSection title="Properties" count={properties.length}>
          <EntityProperties properties={properties} />
        </DetailSection>
      )}
      {relations.length > 0 && (
        <DetailSection title="One-hop relations" count={relations.length}>
          <EntityRelations relations={relations} onEntitySelect={onEntitySelect} />
        </DetailSection>
      )}
    </>
  );
}

function EdgeEndpoint({
  role,
  id,
  entity,
  onEntitySelect,
}: {
  role: string;
  id: string;
  entity?: OntologyEntity;
  onEntitySelect?: (id: string) => void;
}) {
  return (
    <button
      className="ontology-viz-detail__endpoint"
      type="button"
      disabled={!entity || !onEntitySelect}
      onClick={() => entity && onEntitySelect?.(entity.id)}
    >
      <span>{role}</span>
      <strong>{entity ? getOntologyDefaultLabel(entity) : getOntologyCompactIRI(id)}</strong>
      {entity && <small>{entity.kind}</small>}
    </button>
  );
}

function EdgeDetail({
  edge,
  entityById,
  onEntitySelect,
}: {
  edge: OntologyEdge;
  entityById: Map<string, OntologyEntity>;
  onEntitySelect?: (id: string) => void;
}) {
  const source = entityById.get(edge.source);
  const target = entityById.get(edge.target);
  return (
    <>
      <div className="ontology-viz-detail__heading">
        <span>{edge.kind}</span>
        <h2>{edge.label}</h2>
        {edge.propertyIRI && <p>{getOntologyCompactIRI(edge.propertyIRI)}</p>}
      </div>
      <DetailSection title="Endpoints">
        <div className="ontology-viz-detail__endpoints">
          <EdgeEndpoint role="Source" id={edge.source} entity={source} onEntitySelect={onEntitySelect} />
          <EdgeEndpoint role="Target" id={edge.target} entity={target} onEntitySelect={onEntitySelect} />
        </div>
      </DetailSection>
      <DetailSection title="Definition">
        <dl className="ontology-viz-detail__list">
          <DetailRow label="Source IRI" value={edge.source} />
          <DetailRow label="Target IRI" value={edge.target} />
          <DetailRow label="Property IRI" value={edge.propertyIRI} />
        </dl>
      </DetailSection>
    </>
  );
}

export function OntologyDetailPanel({
  item,
  data,
  onClose,
  onEntitySelect,
}: OntologyDetailPanelProps) {
  const entityById = useMemo(
    () => new Map((data?.entities ?? []).map((entity) => [entity.id, entity])),
    [data],
  );

  if (!item) return null;

  return (
    <aside className="ontology-viz-detail" aria-label="Ontology detail">
      <button className="ontology-viz-detail__close" type="button" onClick={onClose} aria-label="Close detail">
        x
      </button>
      {item.type === "entity" ? (
        <EntityDetail
          entity={item.entity}
          data={data}
          entityById={entityById}
          onEntitySelect={onEntitySelect}
        />
      ) : (
        <EdgeDetail
          edge={item.edge}
          entityById={entityById}
          onEntitySelect={onEntitySelect}
        />
      )}
    </aside>
  );
}
