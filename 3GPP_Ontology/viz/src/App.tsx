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
  AVAILABLE_DOMAINS,
  AVAILABLE_GENERATIONS,
} from "./config";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: OntologyGraphData };

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
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
        const data = parseTTLFiles(parts.join("\n"));
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

  // Loading state
  if (loadState.status === "loading") {
    return (
      <div className="app-loading">
        <div className="app-loading__spinner" />
        <p>正在加载 3GPP 本体文件…</p>
        <p className="app-loading__detail">
          {TTL_FILES.map((f) => f.split("/").pop()).join(" · ")}
        </p>
      </div>
    );
  }

  // Error state
  if (loadState.status === "error") {
    return (
      <div className="app-error">
        <h1>加载失败</h1>
        <p>{loadState.message}</p>
        <button onClick={() => window.location.reload()}>重试</button>
      </div>
    );
  }

  const data = loadState.data;

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1 className="app-title">
          3GPP 本体可视化
          <span className="app-subtitle">
            {data.classes.length} 类 · {data.objectProperties.length} 属性 · {data.individuals.length} 参考点
          </span>
        </h1>
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
      </header>

      {/* Filter bar */}
      <FilterBar
        filters={filters}
        availableDomains={AVAILABLE_DOMAINS}
        availableGenerations={AVAILABLE_GENERATIONS}
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
              onClose={() => setSelectedIRI("")}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
