import { useEffect, useState, type ChangeEvent } from "react";
import {
  ConfigurableOntologyViewer,
  parseExplicitOntology,
  type ExplicitOntologyGraphData,
  type ExplicitOntologyParseOptions,
} from "@ontology/viz";

const NPD_ONTOLOGY_PATH = "/npd-ontology/npd-v2-ql.owl";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ExplicitOntologyGraphData; storageKey: string };

function ontologyContentType(fileName: string): ExplicitOntologyParseOptions["contentType"] {
  const lowerName = fileName.toLowerCase();
  return lowerName.endsWith(".ttl") || lowerName.endsWith(".n3") ? "text/turtle" : "application/rdf+xml";
}

function ontologyTitle(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "") || fileName;
}

function importedOntologyStorageKey(file: File) {
  return `file:${file.name}:${file.size}:${file.lastModified}`;
}

export function NpdOwlExplorer() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(NPD_ONTOLOGY_PATH);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${NPD_ONTOLOGY_PATH}: ${response.status}`);
        }
        const content = await response.text();
        const data = parseExplicitOntology(content, {
          baseIRI: "http://sws.ifi.uio.no/vocab/npd-v2",
          contentType: "application/rdf+xml",
          ontologyTitleFallback: "NPD ontology",
        });
        if (!cancelled) setLoadState({ status: "ready", data, storageKey: `path:${NPD_ONTOLOGY_PATH}` });
      } catch (error) {
        if (!cancelled) {
          setLoadState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setLoadState({ status: "loading" });
    try {
      const content = await file.text();
      const data = parseExplicitOntology(content, {
        contentType: ontologyContentType(file.name),
        ontologyTitleFallback: ontologyTitle(file.name),
      });
      setLoadState({ status: "ready", data, storageKey: importedOntologyStorageKey(file) });
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      event.currentTarget.value = "";
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">OntologyViz</h1>
        <div className="app-header__actions">
          <label className="app-import-btn">
            <input
              type="file"
              accept=".owl,.rdf,.xml,.ttl,.n3,application/rdf+xml,text/turtle"
              onChange={handleImport}
            />
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 3v12" />
              <path d="m7 8 5-5 5 5" />
              <path d="M5 15v4h14v-4" />
            </svg>
            <span>导入本体</span>
          </label>
        </div>
      </header>
      {loadState.status === "loading" && (
        <div className="npd-owl-state">
          <div className="app-loading__spinner" />
          <p>加载中</p>
        </div>
      )}
      {loadState.status === "error" && (
        <div className="npd-owl-state">
          <h2>加载失败</h2>
          <p>{loadState.message}</p>
        </div>
      )}
      {loadState.status === "ready" && (
        <ConfigurableOntologyViewer data={loadState.data} storageKey={loadState.storageKey} />
      )}
    </div>
  );
}
