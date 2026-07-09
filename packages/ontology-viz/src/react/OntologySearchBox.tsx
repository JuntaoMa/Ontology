import { useMemo, useState } from "react";

export interface OntologySearchOption {
  id: string;
  label: string;
  description?: string;
}

export interface OntologySearchBoxProps {
  options: OntologySearchOption[];
  placeholder?: string;
  onSelect: (id: string) => void;
}

const MAX_RESULTS = 8;

function matches(option: OntologySearchOption, query: string) {
  const value = `${option.label} ${option.description ?? ""} ${option.id}`.toLowerCase();
  return value.includes(query);
}

export function OntologySearchBox({
  options,
  placeholder = "Search entities...",
  onSelect,
}: OntologySearchBoxProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const results = useMemo(
    () => normalizedQuery
      ? options.filter((option) => matches(option, normalizedQuery)).slice(0, MAX_RESULTS)
      : [],
    [normalizedQuery, options],
  );

  return (
    <div className="ontology-viz-search">
      <input
        type="search"
        value={query}
        placeholder={placeholder}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {results.length > 0 && (
        <div className="ontology-viz-search__results">
          {results.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onSelect(option.id);
                setQuery("");
              }}
            >
              <span>{option.label}</span>
              {option.description && <small>{option.description}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
