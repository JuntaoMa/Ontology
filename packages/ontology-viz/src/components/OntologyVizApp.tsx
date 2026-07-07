import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";

import { parseExplicitOntology } from "../lib/explicitOntologyParser";
import type {
  ExplicitOntologyGraphData,
  ExplicitOntologyParseOptions,
  ExplicitOntologyVisualConfig,
} from "../lib/explicitOntologyTypes";
import {
  ConfigurableOntologyViewer,
  type ConfigurableOntologyViewerProps,
} from "./ConfigurableOntologyViewer";

export interface OntologyVizSource {
  url: string;
  storageKey?: string;
  parseOptions?: ExplicitOntologyParseOptions;
}

export interface OntologyVizAppProps {
  defaultSource?: string | OntologyVizSource;
  initialConfig?: Partial<ExplicitOntologyVisualConfig>;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ExplicitOntologyGraphData; storageKey: string };

function normalizeSource(source: string | OntologyVizSource): OntologyVizSource {
  return typeof source === "string" ? { url: source } : source;
}

function contentTypeFromName(fileName: string): ExplicitOntologyParseOptions["contentType"] {
  const lowerName = fileName.toLowerCase();
  return lowerName.endsWith(".ttl") || lowerName.endsWith(".n3") ? "text/turtle" : "application/rdf+xml";
}

function contentTypeFromResponse(
  contentType: string | null,
  fallbackName: string,
): ExplicitOntologyParseOptions["contentType"] {
  if (contentType?.includes("text/turtle")) return "text/turtle";
  if (contentType?.includes("application/rdf+xml") || contentType?.includes("application/xml")) {
    return "application/rdf+xml";
  }
  return contentTypeFromName(fallbackName);
}

function titleFromPath(path: string) {
  const clean = path.split(/[?#]/)[0] ?? path;
  const fileName = clean.split(/[\\/]/).filter(Boolean).at(-1) ?? clean;
  return fileName.replace(/\.[^.]+$/, "") || "Ontology";
}

function fileStorageKey(file: File) {
  return `file:${file.name}:${file.size}:${file.lastModified}`;
}

function sourceStorageKey(source: OntologyVizSource) {
  return source.storageKey ?? `url:${source.url}`;
}

function ImportButton({ onChange }: { onChange: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="ontology-viz-import-btn">
      <input
        type="file"
        accept=".owl,.rdf,.xml,.ttl,.n3,application/rdf+xml,text/turtle"
        onChange={onChange}
      />
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3v12" />
        <path d="m7 8 5-5 5 5" />
        <path d="M5 15v4h14v-4" />
      </svg>
      <span>导入本体</span>
    </label>
  );
}

export function OntologyVizApp({ defaultSource, initialConfig }: OntologyVizAppProps) {
  const normalizedDefaultSource = useMemo(
    () => defaultSource ? normalizeSource(defaultSource) : undefined,
    [defaultSource],
  );
  const [loadState, setLoadState] = useState<LoadState>(() =>
    normalizedDefaultSource ? { status: "loading" } : { status: "idle" },
  );

  const loadSource = useCallback(async (source: OntologyVizSource) => {
    setLoadState({ status: "loading" });
    try {
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${source.url}: ${response.status}`);
      }
      const content = await response.text();
      const parseOptions: ExplicitOntologyParseOptions = {
        ...source.parseOptions,
        contentType: source.parseOptions?.contentType
          ?? contentTypeFromResponse(response.headers.get("content-type"), source.url),
        ontologyTitleFallback: source.parseOptions?.ontologyTitleFallback ?? titleFromPath(source.url),
      };
      setLoadState({
        status: "ready",
        data: parseExplicitOntology(content, parseOptions),
        storageKey: sourceStorageKey(source),
      });
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    if (!normalizedDefaultSource) {
      setLoadState((current) => current.status === "loading" ? { status: "idle" } : current);
      return;
    }

    const source = normalizedDefaultSource;
    let cancelled = false;
    async function load() {
      setLoadState({ status: "loading" });
      try {
        const response = await fetch(source.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${source.url}: ${response.status}`);
        }
        const content = await response.text();
        const parseOptions: ExplicitOntologyParseOptions = {
          ...source.parseOptions,
          contentType: source.parseOptions?.contentType
            ?? contentTypeFromResponse(response.headers.get("content-type"), source.url),
          ontologyTitleFallback: source.parseOptions?.ontologyTitleFallback
            ?? titleFromPath(source.url),
        };
        if (!cancelled) {
          setLoadState({
            status: "ready",
            data: parseExplicitOntology(content, parseOptions),
            storageKey: sourceStorageKey(source),
          });
        }
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
  }, [normalizedDefaultSource]);

  const handleImport = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setLoadState({ status: "loading" });
    try {
      const content = await file.text();
      const parseOptions: ExplicitOntologyParseOptions = {
        contentType: contentTypeFromName(file.name),
        ontologyTitleFallback: titleFromPath(file.name),
      };
      setLoadState({
        status: "ready",
        data: parseExplicitOntology(content, parseOptions),
        storageKey: fileStorageKey(file),
      });
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      event.currentTarget.value = "";
    }
  }, []);

  const handleRecentOpen: ConfigurableOntologyViewerProps["onRecentOpen"] = useCallback((storageKey: string) => {
    if (!storageKey.startsWith("url:")) return;
    loadSource({ url: storageKey.slice("url:".length), storageKey });
  }, [loadSource]);

  if (loadState.status === "ready") {
    return (
      <div className="ontology-viz-app">
        <ConfigurableOntologyViewer
          data={loadState.data}
          initialConfig={initialConfig}
          storageKey={loadState.storageKey}
          onRecentOpen={handleRecentOpen}
          headerRight={<ImportButton onChange={handleImport} />}
        />
      </div>
    );
  }

  return (
    <div className="ontology-viz-app">
      <div className="ontology-viz-app-state">
        {loadState.status === "loading" && (
          <>
            <div className="ontology-viz-spinner" />
            <p>加载中</p>
          </>
        )}
        {loadState.status === "error" && (
          <>
            <h2>加载失败</h2>
            <p>{loadState.message}</p>
            <ImportButton onChange={handleImport} />
          </>
        )}
        {loadState.status === "idle" && <ImportButton onChange={handleImport} />}
      </div>
    </div>
  );
}
