import type { OntologyG6LayoutMode } from "../g6";

export interface OntologyLayoutControlProps {
  value: OntologyG6LayoutMode;
  onChange: (value: OntologyG6LayoutMode) => void;
}

const LAYOUT_OPTIONS: Array<{ value: OntologyG6LayoutMode; label: string }> = [
  { value: "force-atlas2", label: "ForceAtlas2" },
  { value: "d3-force", label: "D3 Force" },
  { value: "antv-dagre", label: "Dagre" },
];

export function OntologyLayoutControl({ value, onChange }: OntologyLayoutControlProps) {
  return (
    <div className="ontology-viz-layout-control" role="radiogroup" aria-label="Layout">
      {LAYOUT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? "is-active" : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
