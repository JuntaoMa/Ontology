import { ONTOLOGY_G6_LAYOUT_MODES, type OntologyG6LayoutMode } from "../g6";

export interface OntologyLayoutControlProps {
  value: OntologyG6LayoutMode;
  onChange: (value: OntologyG6LayoutMode) => void;
}

const LAYOUT_OPTIONS: Array<{ value: OntologyG6LayoutMode; label: string }> = [
  { value: ONTOLOGY_G6_LAYOUT_MODES[0], label: "ForceAtlas2" },
  { value: ONTOLOGY_G6_LAYOUT_MODES[1], label: "D3 Force" },
  { value: ONTOLOGY_G6_LAYOUT_MODES[2], label: "Dagre" },
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
