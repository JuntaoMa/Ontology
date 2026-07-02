/**
 * 3GPP Ontology Visualization — Main Application
 *
 * Loads TTL ontology files, renders the interactive graph with
 * provenance evidence, and provides domain/generation/provenance
 * filters.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  parseTTLFiles,
  OntologyGraph,
  ProvenancePanel,
  FilterBar,
  type OntologyGraphData,
  type OntologyEntity,
  type GraphFilters,
  type LayoutMode,
} from "@ontology/viz";
import "@ontology/viz/styles";

import {
  TTL_FILES,
  G3PP_COLOR_SCHEME,
  G3PP_PARSE_OPTIONS,
  AVAILABLE_DOMAINS,
  AVAILABLE_GENERATIONS,
  DOMAIN_LABELS,
  FILTER_LABELS,
  PROVENANCE_LEVEL_LABELS,
  PROVENANCE_PANEL_LABELS,
} from "./config";
import { NpdMappingExplorer } from "./npd/NpdMappingExplorer";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: OntologyGraphData };

type AppView = "npd" | "g3pp";

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [activeView, setActiveView] = useState<AppView>("npd");
  const [selectedIRI, setSelectedIRI] = useState("");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("dagre");
  const [filters, setFilters] = useState<GraphFilters>({
    domains: [],
    generations: [],
    provenanceLevels: [],
    search: "",
  });

  // Load TTL files on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Fetch all TTL files and concatenate into one string.
        // Concatenating avoids blank-node ID clashes across rdflib parse() calls.
        const parts: string[] = [];
        for (const path of TTL_FILES) {
          const resp = await fetch(path);
          if (!resp.ok) throw new Error(`Failed to fetch ${path}: ${resp.status}`);
          parts.push(await resp.text());
        }
        const data = parseTTLFiles(parts.join("\n"), G3PP_PARSE_OPTIONS);
        if (!cancelled) setLoadState({ status: "ready", data });
      } catch (err) {
        if (!cancelled) {
          setLoadState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Find selected entity
  const selectedEntity: OntologyEntity | null = useMemo(() => {
    if (loadState.status !== "ready" || !selectedIRI) return null;
    const d = loadState.data;
    return (
      d.classes.find((c) => c.iri === selectedIRI) ??
      d.objectProperties.find((p) => p.iri === selectedIRI) ??
      d.individuals.find((i) => i.iri === selectedIRI) ??
      null
    );
  }, [loadState, selectedIRI]);

  const handleSelect = useCallback((iri: string) => {
    setSelectedIRI((prev) => (prev === iri ? "" : iri));
  }, []);

  const header = (
    <header className="app-header">
      <h1 className="app-title">
        本体建模可视化
        <span className="app-subtitle">
          {activeView === "npd" ? "NPD 表-本体映射" : "3GPP 图谱"}
        </span>
      </h1>
      <div className="app-header__actions">
        <div className="app-view-toggle" aria-label="视图切换">
          <button
            className={`app-view-btn ${activeView === "npd" ? "is-active" : ""}`}
            onClick={() => setActiveView("npd")}
          >
            NPD 映射
          </button>
          <button
            className={`app-view-btn ${activeView === "g3pp" ? "is-active" : ""}`}
            onClick={() => setActiveView("g3pp")}
          >
            3GPP 图谱
          </button>
        </div>
        {activeView === "g3pp" && (
          <div className="app-layout-toggle">
            <button
              className={`app-layout-btn ${layoutMode === "dagre" ? "is-active" : ""}`}
              onClick={() => setLayoutMode("dagre")}
            >
              层次布局
            </button>
            <button
              className={`app-layout-btn ${layoutMode === "force" ? "is-active" : ""}`}
              onClick={() => setLayoutMode("force")}
            >
              力导向
            </button>
          </div>
        )}
      </div>
    </header>
  );

  if (activeView === "npd") {
    return (
      <div className="app">
        {header}
        <NpdMappingExplorer />
      </div>
    );
  }

  // Loading state
  if (loadState.status === "loading") {
    return (
      <div className="app">
        {header}
        <div className="app-loading">
          <div className="app-loading__spinner" />
          <p>正在加载 3GPP 本体文件…</p>
          <p className="app-loading__detail">
            {TTL_FILES.map((f) => f.split("/").pop()).join(" · ")}
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (loadState.status === "error") {
    return (
      <div className="app">
        {header}
        <div className="app-error">
          <h1>加载失败</h1>
          <p>{loadState.message}</p>
          <button onClick={() => window.location.reload()}>重试</button>
        </div>
      </div>
    );
  }

  const data = loadState.data;

  return (
    <div className="app">
      {header}

      {/* Filter bar */}
      <FilterBar
        filters={filters}
        availableDomains={AVAILABLE_DOMAINS}
        availableGenerations={AVAILABLE_GENERATIONS}
        domainLabels={DOMAIN_LABELS}
        colorScheme={G3PP_COLOR_SCHEME}
        labels={FILTER_LABELS}
        onChange={setFilters}
      />

      {/* Main content: graph + floating panel */}
      <div className="app-main">
        <div className="app-graph">
          <OntologyGraph
            data={data}
            selectedIRI={selectedIRI}
            filters={filters}
            layoutMode={layoutMode}
            colorScheme={G3PP_COLOR_SCHEME}
            onSelect={handleSelect}
          />
        </div>
        {selectedEntity && (
          <aside className="app-panel" aria-label="本体详情">
            <ProvenancePanel
              entity={selectedEntity}
              colorScheme={G3PP_COLOR_SCHEME}
              labels={PROVENANCE_PANEL_LABELS}
              levelLabels={PROVENANCE_LEVEL_LABELS}
              onClose={() => setSelectedIRI("")}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
