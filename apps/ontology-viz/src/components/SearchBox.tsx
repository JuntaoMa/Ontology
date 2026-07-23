import { useMemo, useState } from "react";

import type { OntologyDocument } from "../ontology";
import { RESOURCE_LABELS } from "../graph";

export interface SearchBoxProps {
  document: OntologyDocument;
  onSelect: (id: string) => void;
}

export function SearchBox({ document, onSelect }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return document.graph.nodeIds.flatMap((id) => {
      const resource = document.indexes.resourceById.get(id);
      if (!resource) return [];
      const haystack = `${resource.label} ${resource.localName} ${resource.compactIri}`.toLocaleLowerCase();
      return haystack.includes(normalized) ? [resource] : [];
    }).slice(0, 12);
  }, [document, query]);

  return (
    <div className="search-box">
      <span className="search-box__icon" aria-hidden="true">⌕</span>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索实体…"
        aria-label="搜索实体"
      />
      {results.length ? (
        <div className="search-results">
          {results.map((resource) => (
            <button
              key={resource.id}
              type="button"
              onClick={() => {
                onSelect(resource.id);
                setQuery("");
              }}
            >
              <span>{resource.label}</span>
              <small>{RESOURCE_LABELS[resource.kind]}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
