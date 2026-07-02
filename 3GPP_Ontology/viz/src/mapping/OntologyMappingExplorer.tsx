import { useMemo, useState } from "react";
import type { OntologyMappingDataset, OntologyMappingEntry, OntologyMappingKind } from "./types";

const DEFAULT_KIND_LABELS: Record<OntologyMappingKind | "all", string> = {
  all: "全部",
  class: "对象",
  subclass: "子类",
  objectProperty: "关系",
  dataProperty: "属性",
};

const KIND_ORDER: Array<OntologyMappingKind | "all"> = [
  "all",
  "class",
  "subclass",
  "objectProperty",
  "dataProperty",
];

const DEFAULT_LABELS = {
  mappingCount: "映射断言",
  ontologyObjects: "本体对象",
  objectRelations: "对象关系",
  dataProperties: "数据属性",
  sourceTables: "源表",
  search: "搜索",
  searchPlaceholder: "表、列、本体名、SQL",
  abstraction: "抽象类型",
  allAbstractions: "全部抽象",
  sourceTable: "源表",
  allSourceTables: "全部源表",
  matched: "条匹配",
  showFirst: "显示前",
  sourceColumns: "源列",
  targetTriple: "Target Triple",
  sourceSql: "Source SQL",
  condition: "条件",
  noResults: "无匹配映射",
  sourceTablesDetail: "源表",
  ontologyItem: "本体项",
};

export interface OntologyMappingExplorerProps {
  dataset: OntologyMappingDataset;
  className?: string;
  kindLabels?: Partial<Record<OntologyMappingKind | "all", string>>;
  labels?: Partial<typeof DEFAULT_LABELS>;
  maxVisibleEntries?: number;
}

function includesText(entry: OntologyMappingEntry, text: string) {
  if (!text) return true;
  const haystack = [
    entry.id,
    entry.entityName,
    entry.abstraction,
    entry.target,
    entry.sourceSql,
    ...entry.sourceTables,
    ...entry.sourceColumns,
  ].join(" ").toLowerCase();
  return haystack.includes(text.toLowerCase());
}

function listSourceTables(entries: OntologyMappingEntry[]) {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    for (const sourceTable of entry.sourceTables) {
      counts[sourceTable] = (counts[sourceTable] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([table]) => table);
}

export function OntologyMappingExplorer({
  dataset,
  className,
  kindLabels,
  labels: labelOverrides,
  maxVisibleEntries = 240,
}: OntologyMappingExplorerProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<OntologyMappingKind | "all">("all");
  const [abstraction, setAbstraction] = useState("all");
  const [table, setTable] = useState("all");
  const [selectedId, setSelectedId] = useState(dataset.entries[0]?.id ?? "");
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const kindLabelMap = { ...DEFAULT_KIND_LABELS, ...kindLabels };

  const abstractions = useMemo(() => {
    return Object.entries(dataset.totals.byAbstraction)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
  }, [dataset]);

  const sourceTables = useMemo(() => listSourceTables(dataset.entries), [dataset]);

  const filtered = useMemo(() => {
    return dataset.entries.filter((entry) => {
      if (kind !== "all" && entry.kind !== kind) return false;
      if (abstraction !== "all" && entry.abstraction !== abstraction) return false;
      if (table !== "all" && !entry.sourceTables.includes(table)) return false;
      return includesText(entry, query.trim());
    });
  }, [abstraction, dataset, kind, query, table]);

  const selected = useMemo(() => {
    return filtered.find((entry) => entry.id === selectedId) ?? filtered[0] ?? null;
  }, [filtered, selectedId]);

  const visibleEntries = filtered.slice(0, maxVisibleEntries);
  const rootClass = ["mapping-map", className].filter(Boolean).join(" ");

  return (
    <div className={rootClass}>
      <section className="mapping-map__summary" aria-label="映射统计">
        <div className="mapping-stat">
          <span className="mapping-stat__value">{dataset.mappingCount}</span>
          <span className="mapping-stat__label">{labels.mappingCount}</span>
        </div>
        <div className="mapping-stat">
          <span className="mapping-stat__value">
            {(dataset.totals.byKind.class ?? 0) + (dataset.totals.byKind.subclass ?? 0)}
          </span>
          <span className="mapping-stat__label">{labels.ontologyObjects}</span>
        </div>
        <div className="mapping-stat">
          <span className="mapping-stat__value">{dataset.totals.byKind.objectProperty ?? 0}</span>
          <span className="mapping-stat__label">{labels.objectRelations}</span>
        </div>
        <div className="mapping-stat">
          <span className="mapping-stat__value">{dataset.totals.byKind.dataProperty ?? 0}</span>
          <span className="mapping-stat__label">{labels.dataProperties}</span>
        </div>
        <div className="mapping-stat">
          <span className="mapping-stat__value">{Object.keys(dataset.totals.byTable).length}</span>
          <span className="mapping-stat__label">{labels.sourceTables}</span>
        </div>
      </section>

      <section className="mapping-map__workspace">
        <aside className="mapping-filter" aria-label="映射筛选">
          <label className="mapping-field">
            <span>{labels.search}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={labels.searchPlaceholder}
            />
          </label>

          <div className="mapping-filter__group" aria-label="映射类型">
            {KIND_ORDER.map((item) => (
              <button
                key={item}
                className={kind === item ? "is-active" : ""}
                onClick={() => setKind(item)}
              >
                {kindLabelMap[item]}
              </button>
            ))}
          </div>

          <label className="mapping-field">
            <span>{labels.abstraction}</span>
            <select value={abstraction} onChange={(event) => setAbstraction(event.target.value)}>
              <option value="all">{labels.allAbstractions}</option>
              {abstractions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>

          <label className="mapping-field">
            <span>{labels.sourceTable}</span>
            <select value={table} onChange={(event) => setTable(event.target.value)}>
              <option value="all">{labels.allSourceTables}</option>
              {sourceTables.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
        </aside>

        <main className="mapping-results" aria-label="映射列表">
          <div className="mapping-results__bar">
            <strong>{filtered.length}</strong>
            <span>{labels.matched}</span>
            {filtered.length > visibleEntries.length && (
              <span>{labels.showFirst} {visibleEntries.length} 条</span>
            )}
          </div>

          <div className="mapping-list">
            {visibleEntries.map((entry) => (
              <button
                key={entry.id}
                className={`mapping-row ${selected?.id === entry.id ? "is-selected" : ""}`}
                onClick={() => setSelectedId(entry.id)}
              >
                <span className={`mapping-kind mapping-kind--${entry.kind}`}>
                  {kindLabelMap[entry.kind]}
                </span>
                <span className="mapping-row__main">
                  <strong>{entry.entityPrefix}:{entry.entityName}</strong>
                  <span>{entry.abstraction}</span>
                </span>
                <span className="mapping-row__source">
                  {entry.sourceTables.slice(0, 3).join(" · ")}
                  {entry.sourceTables.length > 3 ? " ..." : ""}
                </span>
              </button>
            ))}
          </div>
        </main>

        <aside className="mapping-detail" aria-label="映射详情">
          {selected ? (
            <MappingDetail entry={selected} labels={labels} kindLabels={kindLabelMap} />
          ) : (
            <p>{labels.noResults}</p>
          )}
        </aside>
      </section>
    </div>
  );
}

function MappingDetail({
  entry,
  labels,
  kindLabels,
}: {
  entry: OntologyMappingEntry;
  labels: typeof DEFAULT_LABELS;
  kindLabels: Record<OntologyMappingKind | "all", string>;
}) {
  return (
    <>
      <div className="mapping-detail__head">
        <span className={`mapping-kind mapping-kind--${entry.kind}`}>
          {kindLabels[entry.kind]}
        </span>
        <h2>{entry.entityPrefix}:{entry.entityName}</h2>
        <p>{entry.abstraction}</p>
      </div>

      <div className="mapping-flow">
        <div>
          <span className="mapping-flow__label">{labels.sourceTablesDetail}</span>
          <div className="mapping-chipset">
            {entry.sourceTables.map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
        <div>
          <span className="mapping-flow__label">{labels.ontologyItem}</span>
          <strong>{entry.entityName}</strong>
          <small>{entry.targetPredicate}</small>
        </div>
      </div>

      <section className="mapping-detail__section">
        <h3>{labels.sourceColumns}</h3>
        <div className="mapping-chipset mapping-chipset--dense">
          {entry.sourceColumns.slice(0, 80).map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      <section className="mapping-detail__section">
        <h3>{labels.targetTriple}</h3>
        <pre>{entry.target}</pre>
      </section>

      <section className="mapping-detail__section">
        <h3>{labels.sourceSql}</h3>
        <pre>{entry.sourceSql}</pre>
      </section>

      {entry.condition && (
        <section className="mapping-detail__section">
          <h3>{labels.condition}</h3>
          <code>{entry.condition}</code>
        </section>
      )}
    </>
  );
}
