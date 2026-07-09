import { useEffect, useRef, useState } from "react";

import type { OntologyEntityKind } from "../core";
import {
  ONTOLOGY_G6_ENTITY_KINDS,
  ONTOLOGY_G6_NODE_COLORS,
  type OntologyG6AdapterOptions,
} from "../g6";

export interface OntologyVisualSettingsProps {
  value: OntologyG6AdapterOptions;
  availableEntityKinds?: OntologyEntityKind[];
  onChange: (value: OntologyG6AdapterOptions) => void;
}

const ENTITY_KIND_LABELS: Record<OntologyEntityKind, string> = {
  Class: "Class",
  ObjectProperty: "ObjectProperty",
  DatatypeProperty: "DatatypeProperty",
  AnnotationProperty: "AnnotationProperty",
};

function isEnabled(value: boolean | undefined) {
  return value ?? true;
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
      <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.1 2.1 0 0 1-2.97 2.97l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.65V21a2.1 2.1 0 0 1-4.2 0v-.06a1.8 1.8 0 0 0-1.1-1.65 1.8 1.8 0 0 0-1.98.36l-.04.04a2.1 2.1 0 1 1-2.97-2.97l.04-.04A1.8 1.8 0 0 0 3.8 15a1.8 1.8 0 0 0-1.65-1.1H2.1a2.1 2.1 0 0 1 0-4.2h.06A1.8 1.8 0 0 0 3.8 8a1.8 1.8 0 0 0-.36-1.98l-.04-.04A2.1 2.1 0 1 1 6.37 3l.04.04A1.8 1.8 0 0 0 8.4 3.4a1.8 1.8 0 0 0 1.1-1.65V1.7a2.1 2.1 0 1 1 4.2 0v.06a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 1.98-.36l.04-.04A2.1 2.1 0 1 1 19.8 6l-.04.04A1.8 1.8 0 0 0 19.4 8a1.8 1.8 0 0 0 1.65 1.1h.06a2.1 2.1 0 0 1 0 4.2h-.06A1.8 1.8 0 0 0 19.4 15Z" />
    </svg>
  );
}

export function OntologyVisualSettings({
  value,
  availableEntityKinds = ONTOLOGY_G6_ENTITY_KINDS,
  onChange,
}: OntologyVisualSettingsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const visibleKinds = new Set(value.visibleEntityKinds ?? ONTOLOGY_G6_ENTITY_KINDS);
  const kindOptions = ONTOLOGY_G6_ENTITY_KINDS.filter((kind) => availableEntityKinds.includes(kind));

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: PointerEvent) {
      const root = rootRef.current;
      const target = event.target;
      if (!root || !(target instanceof Node) || root.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function patch(nextValue: Partial<OntologyG6AdapterOptions>) {
    onChange({ ...value, ...nextValue });
  }

  function toggleKind(kind: OntologyEntityKind) {
    const nextKinds = new Set(visibleKinds);
    if (nextKinds.has(kind)) nextKinds.delete(kind);
    else nextKinds.add(kind);
    patch({
      visibleEntityKinds: ONTOLOGY_G6_ENTITY_KINDS.filter((item) => nextKinds.has(item)),
    });
  }

  return (
    <div className="ontology-viz-settings" ref={rootRef}>
      <button
        type="button"
        className="ontology-viz-settings__trigger"
        aria-label="Visual settings"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <SettingsIcon />
      </button>
      {open && (
        <div className="ontology-viz-settings__panel">
          <section>
            <h3>Nodes</h3>
            <div className="ontology-viz-settings__checks">
              {kindOptions.map((kind) => (
                <label key={kind} className="ontology-viz-settings__check">
                  <input
                    type="checkbox"
                    checked={visibleKinds.has(kind)}
                    onChange={() => toggleKind(kind)}
                  />
                  <span
                    className="ontology-viz-settings__swatch"
                    style={{ background: ONTOLOGY_G6_NODE_COLORS[kind] }}
                  />
                  <span>{ENTITY_KIND_LABELS[kind]}</span>
                </label>
              ))}
            </div>
            <label className="ontology-viz-settings__toggle">
              <input
                type="checkbox"
                checked={isEnabled(value.showNodeLabels)}
                onChange={(event) => patch({ showNodeLabels: event.currentTarget.checked })}
              />
              <span>Node labels</span>
            </label>
          </section>
          <section>
            <h3>Edges</h3>
            <label className="ontology-viz-settings__toggle">
              <input
                type="checkbox"
                checked={isEnabled(value.showEdgeLabels)}
                onChange={(event) => patch({ showEdgeLabels: event.currentTarget.checked })}
              />
              <span>Edge labels</span>
            </label>
            <label className="ontology-viz-settings__toggle">
              <input
                type="checkbox"
                checked={isEnabled(value.showEdgeArrows)}
                onChange={(event) => patch({ showEdgeArrows: event.currentTarget.checked })}
              />
              <span>Edge arrows</span>
            </label>
          </section>
        </div>
      )}
    </div>
  );
}
