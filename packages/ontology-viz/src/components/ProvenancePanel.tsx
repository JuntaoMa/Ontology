/**
 * @ontology/viz — ProvenancePanel component
 *
 * Side panel displaying the provenance evidence for a selected
 * ontology entity. Shows L1/L2/L3 classification and all
 * associated annotations (specRef, specClause, designRationale,
 * derivedFrom, scopeNote).
 */

import type { OntologyEntity, OntologyObjectProperty, Provenance } from "../lib/types";
import { DEFAULT_COLOR_SCHEME } from "../lib/colors";

/** Safely narrow OntologyEntity to OntologyObjectProperty */
function asProp(entity: OntologyEntity): OntologyObjectProperty | null {
  if (entity.kind === "objectProperty") return entity as OntologyObjectProperty;
  return null;
}

// ─── Helpers ────────────────────────────────────────────────────

function LevelBadge({ level }: { level: string }) {
  const color = DEFAULT_COLOR_SCHEME.provenanceColors[level as keyof typeof DEFAULT_COLOR_SCHEME.provenanceColors] ?? "#6b7280";

  const labels: Record<string, string> = {
    L1: "L1 · spec 直接引用",
    L2: "L2 · 本体推导",
    L3: "L3 · 非规范扩展",
  };

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
  /** Called to close/deselect */
  onClose: () => void;
}

export function ProvenancePanel({ entity, onClose }: ProvenancePanelProps) {
  if (!entity) {
    return (
      <div className="prov-panel prov-panel--empty">
        <p className="prov-panel__hint">点击节点或边查看溯源证据</p>
      </div>
    );
  }

  const p = entity.provenance;
  const eKind = entity.kind;
  const isIndividual = eKind === "individual";
  const isClass = eKind === "class";
  const isProp = eKind === "objectProperty";

  return (
    <div className="prov-panel">
      <div className="prov-panel__header">
        <h2 className="prov-panel__title">
          {entity.labelZh ?? entity.label}
        </h2>
        <button className="prov-panel__close" onClick={onClose} title="关闭">
          ×
        </button>
      </div>

      {/* Entity metadata */}
      <section className="prov-section">
        <h3 className="prov-section__title">基本信息</h3>
        <dl className="prov-dl">
          <dt>IRI</dt>
          <dd className="prov-iri">{entity.iri}</dd>

          {entity.abbreviation && (
            <>
              <dt>缩写</dt>
              <dd>{entity.abbreviation}</dd>
            </>
          )}

          <dt>类型</dt>
          <dd>
            {isClass ? "类 (owl:Class)" : isProp ? "对象属性 (owl:ObjectProperty)" : "个体 (NamedIndividual)"}
          </dd>

          {entity.labelZh && entity.labelZh !== entity.label && (
            <>
              <dt>中文名</dt>
              <dd>{entity.labelZh}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Comment */}
      {entity.comment && (
        <section className="prov-section">
          <h3 className="prov-section__title">描述</h3>
          <p className="prov-comment">{entity.comment}</p>
        </section>
      )}

      {/* Provenance */}
      <section className="prov-section">
        <h3 className="prov-section__title">溯源证据</h3>
        <LevelBadge level={p.level} />

        <dl className="prov-dl">
          {p.specRef && (
            <>
              <dt>Spec 引用</dt>
              <dd className="prov-source">{p.specRef}</dd>
            </>
          )}

          {p.specClause && (
            <>
              <dt>条款</dt>
              <dd className="prov-source">{p.specClause}</dd>
            </>
          )}

          {p.source && !p.specRef && (
            <>
              <dt>数据源</dt>
              <dd className="prov-source">{p.source}</dd>
            </>
          )}

          {p.derivedFrom && p.derivedFrom.length > 0 && (
            <>
              <dt>推导自</dt>
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
              <dt>设计理由</dt>
              <dd className="prov-rationale">{p.designRationale}</dd>
            </>
          )}

          {p.scopeNote && (
            <>
              <dt>范围说明</dt>
              <dd className="prov-scope">{p.scopeNote}</dd>
            </>
          )}
        </dl>
      </section>

      {/* For object properties: extra topology info */}
      {isProp && asProp(entity) && (
        <section className="prov-section">
          <h3 className="prov-section__title">拓扑约束</h3>
          <dl className="prov-dl">
            {asProp(entity)!.domainIRI && (
              <>
                <dt>domain</dt>
                <dd className="prov-iri">{asProp(entity)!.domainIRI!.split("#").pop()}</dd>
              </>
            )}
            {asProp(entity)!.rangeIRI && (
              <>
                <dt>range</dt>
                <dd className="prov-iri">{asProp(entity)!.rangeIRI!.split("#").pop()}</dd>
              </>
            )}
            {asProp(entity)!.parentIRIs.length > 0 && (
              <>
                <dt>subPropertyOf</dt>
                <dd>
                  <ul className="prov-list">
                    {asProp(entity)!.parentIRIs.map((p) => (
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
