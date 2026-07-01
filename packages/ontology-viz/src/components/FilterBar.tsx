/**
 * @ontology/viz — FilterBar component
 *
 * Toolbar for filtering the ontology graph by domain, generation,
 * provenance level, and free-text search.
 */

import type { GraphFilters, ProvenanceLevel } from "../lib/types";
import { DEFAULT_DOMAIN_COLORS } from "../lib/colors";

export interface FilterBarProps {
  filters: GraphFilters;
  /** Available domain keys in the current ontology */
  availableDomains: string[];
  /** Available generations in the current ontology */
  availableGenerations: string[];
  onChange: (filters: GraphFilters) => void;
}

export function FilterBar({
  filters,
  availableDomains,
  availableGenerations,
  onChange,
}: FilterBarProps) {
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
        <span className="filter-bar__label">搜索</span>
        <input
          className="filter-bar__search"
          type="text"
          placeholder="类名、缩写、描述…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </div>

      {availableDomains.length > 0 && (
        <div className="filter-bar__group">
          <span className="filter-bar__label">域</span>
          <button
            className={`filter-chip ${allDomains ? "is-active" : ""}`}
            onClick={() => onChange({ ...filters, domains: [] })}
          >
            全部
          </button>
          {availableDomains.map((domain) => (
            <button
              key={domain}
              className={`filter-chip ${filters.domains.includes(domain) ? "is-active" : ""}`}
              style={{
                borderColor: filters.domains.includes(domain)
                  ? DEFAULT_DOMAIN_COLORS[domain] ?? "#6b7280"
                  : "transparent",
              }}
              onClick={() => toggleDomain(domain)}
            >
              <span
                className="filter-chip__dot"
                style={{ backgroundColor: DEFAULT_DOMAIN_COLORS[domain] ?? "#6b7280" }}
              />
              {domain.replace("Domain", "")}
            </button>
          ))}
        </div>
      )}

      {availableGenerations.length > 0 && (
        <div className="filter-bar__group">
          <span className="filter-bar__label">代际</span>
          <button
            className={`filter-chip ${allGens ? "is-active" : ""}`}
            onClick={() => onChange({ ...filters, generations: [] })}
          >
            全部
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
        <span className="filter-bar__label">溯源层级</span>
        <button
          className={`filter-chip ${allProv ? "is-active" : ""}`}
          onClick={() => onChange({ ...filters, provenanceLevels: [] })}
        >
          全部
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
