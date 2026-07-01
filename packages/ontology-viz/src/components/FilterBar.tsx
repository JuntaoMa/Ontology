/**
 * @ontology/viz — FilterBar component
 *
 * Toolbar for filtering the ontology graph by domain, generation,
 * provenance level, and free-text search.
 */

import type {
  DomainColorScheme,
  FilterBarLabels,
  GraphFilters,
  ProvenanceLevel,
} from "../lib/types";
import { DEFAULT_COLOR_SCHEME } from "../lib/colors";

const DEFAULT_FILTER_LABELS: FilterBarLabels = {
  search: "Search",
  searchPlaceholder: "Name, abbreviation, description...",
  domains: "Domains",
  generations: "Generations",
  provenanceLevels: "Provenance",
  all: "All",
};

export interface FilterBarProps {
  filters: GraphFilters;
  /** Available domain keys in the current ontology */
  availableDomains: string[];
  /** Available generations in the current ontology */
  availableGenerations: string[];
  /** Optional display labels for domain keys */
  domainLabels?: Record<string, string>;
  /** Optional colour scheme for domain filter chips */
  colorScheme?: DomainColorScheme;
  /** UI text overrides */
  labels?: Partial<FilterBarLabels>;
  onChange: (filters: GraphFilters) => void;
}

export function FilterBar({
  filters,
  availableDomains,
  availableGenerations,
  domainLabels = {},
  colorScheme = DEFAULT_COLOR_SCHEME,
  labels: labelOverrides = {},
  onChange,
}: FilterBarProps) {
  const labels = { ...DEFAULT_FILTER_LABELS, ...labelOverrides };

  const toggleDomain = (domain: string) => {
    const next = filters.domains.includes(domain)
      ? filters.domains.filter((d) => d !== domain)
      : [...filters.domains, domain];
    onChange({ ...filters, domains: next });
  };

  const toggleGeneration = (gen: string) => {
    const next = filters.generations.includes(gen)
      ? filters.generations.filter((g) => g !== gen)
      : [...filters.generations, gen];
    onChange({ ...filters, generations: next });
  };

  const toggleProvenance = (level: ProvenanceLevel) => {
    const next = filters.provenanceLevels.includes(level)
      ? filters.provenanceLevels.filter((l) => l !== level)
      : [...filters.provenanceLevels, level];
    onChange({ ...filters, provenanceLevels: next });
  };

  const allDomains = filters.domains.length === 0;
  const allGens = filters.generations.length === 0;
  const allProv = filters.provenanceLevels.length === 0;

  return (
    <div className="filter-bar">
      <div className="filter-bar__group">
        <span className="filter-bar__label">{labels.search}</span>
        <input
          className="filter-bar__search"
          type="text"
          placeholder={labels.searchPlaceholder}
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </div>

      {availableDomains.length > 0 && (
        <div className="filter-bar__group">
          <span className="filter-bar__label">{labels.domains}</span>
          <button
            className={`filter-chip ${allDomains ? "is-active" : ""}`}
            onClick={() => onChange({ ...filters, domains: [] })}
          >
            {labels.all}
          </button>
          {availableDomains.map((domain) => (
            <button
              key={domain}
              className={`filter-chip ${filters.domains.includes(domain) ? "is-active" : ""}`}
              style={{
                borderColor: filters.domains.includes(domain)
                  ? colorScheme.domainColors[domain] ?? colorScheme.defaultNodeColor
                  : "transparent",
              }}
              onClick={() => toggleDomain(domain)}
            >
              <span
                className="filter-chip__dot"
                style={{
                  backgroundColor: colorScheme.domainColors[domain] ??
                    colorScheme.defaultNodeColor,
                }}
              />
              {domainLabels[domain] ?? domain.replace(/Domain$/, "")}
            </button>
          ))}
        </div>
      )}

      {availableGenerations.length > 0 && (
        <div className="filter-bar__group">
          <span className="filter-bar__label">{labels.generations}</span>
          <button
            className={`filter-chip ${allGens ? "is-active" : ""}`}
            onClick={() => onChange({ ...filters, generations: [] })}
          >
            {labels.all}
          </button>
          {availableGenerations.map((gen) => (
            <button
              key={gen}
              className={`filter-chip ${filters.generations.includes(gen) ? "is-active" : ""}`}
              onClick={() => toggleGeneration(gen)}
            >
              {gen}
            </button>
          ))}
        </div>
      )}

      <div className="filter-bar__group">
        <span className="filter-bar__label">{labels.provenanceLevels}</span>
        <button
          className={`filter-chip ${allProv ? "is-active" : ""}`}
          onClick={() => onChange({ ...filters, provenanceLevels: [] })}
        >
          {labels.all}
        </button>
        {(["L1", "L2", "L3"] as ProvenanceLevel[]).map((level) => (
          <button
            key={level}
            className={`filter-chip ${filters.provenanceLevels.includes(level) ? "is-active" : ""}`}
            onClick={() => toggleProvenance(level)}
          >
            {level}
          </button>
        ))}
      </div>
    </div>
  );
}
