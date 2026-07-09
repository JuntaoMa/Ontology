import {
  getOntologyDefaultDescription,
  getOntologyDefaultLabel,
  type OntologyEdge,
  type OntologyEntity,
} from "../core";

export type OntologyDetailItem =
  | { type: "entity"; entity: OntologyEntity }
  | { type: "edge"; edge: OntologyEdge };

export interface OntologyDetailPanelProps {
  item?: OntologyDetailItem;
  onClose?: () => void;
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="ontology-viz-detail__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EntityDetail({ entity }: { entity: OntologyEntity }) {
  const description = getOntologyDefaultDescription(entity);

  return (
    <>
      <div className="ontology-viz-detail__heading">
        <span>{entity.kind}</span>
        <h2>{getOntologyDefaultLabel(entity)}</h2>
      </div>
      <dl className="ontology-viz-detail__list">
        <DetailRow label="IRI" value={entity.iri} />
        <DetailRow label="Local name" value={entity.localName} />
        <DetailRow label="Namespace" value={entity.namespace} />
        <DetailRow label="Description" value={description} />
      </dl>
    </>
  );
}

function EdgeDetail({ edge }: { edge: OntologyEdge }) {
  return (
    <>
      <div className="ontology-viz-detail__heading">
        <span>{edge.kind}</span>
        <h2>{edge.label}</h2>
      </div>
      <dl className="ontology-viz-detail__list">
        <DetailRow label="Source" value={edge.source} />
        <DetailRow label="Target" value={edge.target} />
        <DetailRow label="Property IRI" value={edge.propertyIRI} />
      </dl>
    </>
  );
}

export function OntologyDetailPanel({ item, onClose }: OntologyDetailPanelProps) {
  if (!item) return null;

  return (
    <aside className="ontology-viz-detail" aria-label="Ontology detail">
      <button className="ontology-viz-detail__close" type="button" onClick={onClose} aria-label="Close detail">
        x
      </button>
      {item.type === "entity" ? (
        <EntityDetail entity={item.entity} />
      ) : (
        <EdgeDetail edge={item.edge} />
      )}
    </aside>
  );
}
