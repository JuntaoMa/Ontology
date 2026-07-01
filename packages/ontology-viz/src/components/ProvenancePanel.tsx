/**
 * @ontology/viz — ProvenancePanel component
 *
 * Side panel displaying the provenance evidence for a selected
 * ontology entity. Shows L1/L2/L3 classification and all
 * associated annotations (specRef, specClause, designRationale,
 * derivedFrom, scopeNote).
 */

import type {
  DomainColorScheme,
  OntologyEntity,
  OntologyObjectProperty,
  ProvenancePanelLabels,
  ProvenanceLevel,
} from "../lib/types";
import { DEFAULT_COLOR_SCHEME } from "../lib/colors";

/** Safely narrow OntologyEntity to OntologyObjectProperty */
function asProp(entity: OntologyEntity): OntologyObjectProperty | null {
  if (entity.kind === "objectProperty") return entity as OntologyObjectProperty;
  return null;
}

// ─── Helpers ────────────────────────────────────────────────────

const DEFAULT_LEVEL_LABELS: Record<ProvenanceLevel, string> = {
  L1: "L1 · direct reference",
  L2: "L2 · inferred model",
  L3: "L3 · non-normative extension",
};

const DEFAULT_PANEL_LABELS: ProvenancePanelLabels = {
  closeTitle: "Close",
  basicInfo: "Basic Info",
  iri: "IRI",
  abbreviation: "Abbreviation",
  type: "Type",
  classType: "Class (owl:Class)",
  objectPropertyType: "Object property (owl:ObjectProperty)",
  individualType: "Individual (NamedIndividual)",
  secondaryName: "Secondary name",
  description: "Description",
  provenance: "Provenance",
  specRef: "Spec reference",
  specClause: "Clause",
  source: "Source",
  derivedFrom: "Derived from",
  designRationale: "Design rationale",
  scopeNote: "Scope note",
  topology: "Topology",
  domain: "domain",
  range: "range",
  subPropertyOf: "subPropertyOf",
};

function LevelBadge({
  level,
  colorScheme,
  labels,
}: {
  level: ProvenanceLevel;
  colorScheme: DomainColorScheme;
  labels: Record<ProvenanceLevel, string>;
}) {
  const color = colorScheme.provenanceColors[level] ?? colorScheme.defaultNodeColor;

  return (
    <span
      className="prov-level-badge"
      style={{ color, borderColor: color }}
    >
      {labels[level] ?? level}
    </span>
  );
}

// ─── Component ──────────────────────────────────────────────────

export interface ProvenancePanelProps {
  /** Selected entity, or null if nothing selected */
  entity: OntologyEntity | null;
  /** Optional colour scheme for provenance level markers */
  colorScheme?: DomainColorScheme;
  /** UI text overrides */
  labels?: Partial<ProvenancePanelLabels>;
  /** Provenance level label overrides */
  levelLabels?: Partial<Record<ProvenanceLevel, string>>;
  /** Called to close/deselect */
  onClose: () => void;
}

export function ProvenancePanel({
  entity,
  colorScheme = DEFAULT_COLOR_SCHEME,
  labels: labelOverrides = {},
  levelLabels: levelLabelOverrides = {},
  onClose,
}: ProvenancePanelProps) {
  if (!entity) {
    return null;
  }

  const labels = { ...DEFAULT_PANEL_LABELS, ...labelOverrides };
  const levelLabels = { ...DEFAULT_LEVEL_LABELS, ...levelLabelOverrides };
  const p = entity.provenance;
  const eKind = entity.kind;
  const isClass = eKind === "class";
  const prop = asProp(entity);
  const isProp = Boolean(prop);

  return (
    <div className="prov-panel">
      <div className="prov-panel__header">
        <h2 className="prov-panel__title">
          {entity.labelZh ?? entity.label}
        </h2>
        <button
          className="prov-panel__close"
          onClick={onClose}
          title={labels.closeTitle}
        >
          ×
        </button>
      </div>

      {/* Entity metadata */}
      <section className="prov-section">
        <h3 className="prov-section__title">{labels.basicInfo}</h3>
        <dl className="prov-dl">
          <dt>{labels.iri}</dt>
          <dd className="prov-iri">{entity.iri}</dd>

          {entity.abbreviation && (
            <>
              <dt>{labels.abbreviation}</dt>
              <dd>{entity.abbreviation}</dd>
            </>
          )}

          <dt>{labels.type}</dt>
          <dd>
            {isClass
              ? labels.classType
              : isProp
                ? labels.objectPropertyType
                : labels.individualType}
          </dd>

          {entity.labelZh && entity.labelZh !== entity.label && (
            <>
              <dt>{labels.secondaryName}</dt>
              <dd>{entity.labelZh}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Comment */}
      {entity.comment && (
        <section className="prov-section">
          <h3 className="prov-section__title">{labels.description}</h3>
          <p className="prov-comment">{entity.comment}</p>
        </section>
      )}

      {/* Provenance */}
      <section className="prov-section">
        <h3 className="prov-section__title">{labels.provenance}</h3>
        <LevelBadge
          level={p.level}
          colorScheme={colorScheme}
          labels={levelLabels}
        />

        <dl className="prov-dl">
          {p.specRef && (
            <>
              <dt>{labels.specRef}</dt>
              <dd className="prov-source">{p.specRef}</dd>
            </>
          )}

          {p.specClause && (
            <>
              <dt>{labels.specClause}</dt>
              <dd className="prov-source">{p.specClause}</dd>
            </>
          )}

          {p.source && !p.specRef && (
            <>
              <dt>{labels.source}</dt>
              <dd className="prov-source">{p.source}</dd>
            </>
          )}

          {p.derivedFrom && p.derivedFrom.length > 0 && (
            <>
              <dt>{labels.derivedFrom}</dt>
              <dd>
                <ul className="prov-list">
                  {p.derivedFrom.map((d, i) => (
                    <li key={i} className="prov-source">{d}</li>
                  ))}
                </ul>
              </dd>
            </>
          )}

          {p.designRationale && (
            <>
              <dt>{labels.designRationale}</dt>
              <dd className="prov-rationale">{p.designRationale}</dd>
            </>
          )}

          {p.scopeNote && (
            <>
              <dt>{labels.scopeNote}</dt>
              <dd className="prov-scope">{p.scopeNote}</dd>
            </>
          )}
        </dl>
      </section>

      {/* For object properties: extra topology info */}
      {prop && (
        <section className="prov-section">
          <h3 className="prov-section__title">{labels.topology}</h3>
          <dl className="prov-dl">
            {prop.domainIRI && (
              <>
                <dt>{labels.domain}</dt>
                <dd className="prov-iri">{prop.domainIRI.split("#").pop()}</dd>
              </>
            )}
            {prop.rangeIRI && (
              <>
                <dt>{labels.range}</dt>
                <dd className="prov-iri">{prop.rangeIRI.split("#").pop()}</dd>
              </>
            )}
            {prop.parentIRIs.length > 0 && (
              <>
                <dt>{labels.subPropertyOf}</dt>
                <dd>
                  <ul className="prov-list">
                    {prop.parentIRIs.map((p) => (
                      <li key={p} className="prov-iri">{p.split("#").pop()}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
        </section>
      )}
    </div>
  );
}
