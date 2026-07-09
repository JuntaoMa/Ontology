import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";

import {
  getOntologyDefaultLabel,
  parseOntology,
  type OntologyEntityKind,
  type OntologyGraphData,
  type OntologyParseOptions,
} from "../core";
import {
  createG6StandalonePlugins,
  ONTOLOGY_G6_ENTITY_KINDS,
  ONTOLOGY_G6_LAYOUT_MODES,
  type OntologyG6AdapterOptions,
  type OntologyG6LayoutMode,
} from "../g6";
import {
  OntologyDetailPanel,
  OntologyGraphCanvas,
  OntologyLayoutControl,
  OntologySearchBox,
  OntologyVisualSettings,
  type OntologyDetailItem,
  type OntologySearchOption,
} from "../react";

export interface OntologyVizSource {
  url: string;
  storageKey?: string;
  parseOptions?: OntologyParseOptions;
}

export interface OntologyVizAppProps {
  defaultSource?: string | OntologyVizSource;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: OntologyGraphData; sourceKey: string };

type SelectionState =
  | { type: "node"; id: string }
  | { type: "edge"; id: string }
  | undefined;

interface OntologyViewPreferences {
  layoutMode?: OntologyG6LayoutMode;
  adapterOptions?: OntologyG6AdapterOptions;
}

const DEFAULT_LAYOUT_MODE: OntologyG6LayoutMode = "force-atlas2";
const VIEW_PREFERENCES_PREFIX = "ontology-viz:view:";

function normalizeSource(source: string | OntologyVizSource): OntologyVizSource {
  return typeof source === "string" ? { url: source } : source;
}

function contentTypeFromName(fileName: string): OntologyParseOptions["contentType"] {
  const lowerName = fileName.toLowerCase();
  return lowerName.endsWith(".ttl") || lowerName.endsWith(".n3") ? "text/turtle" : "application/rdf+xml";
}

function contentTypeFromResponse(
  contentType: string | null,
  fallbackName: string,
): OntologyParseOptions["contentType"] {
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

function sourceKeyFromSource(source: OntologyVizSource) {
  return source.storageKey ?? source.url;
}

function hashContent(content: string) {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sourceKeyFromFile(file: File, content: string) {
  return `file:${file.name}:${hashContent(content)}`;
}

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isLayoutMode(value: unknown): value is OntologyG6LayoutMode {
  return typeof value === "string" && ONTOLOGY_G6_LAYOUT_MODES.includes(value as OntologyG6LayoutMode);
}

function normalizeAdapterOptions(value: unknown): OntologyG6AdapterOptions | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const options: OntologyG6AdapterOptions = {};

  if (Array.isArray(record.visibleEntityKinds)) {
    options.visibleEntityKinds = record.visibleEntityKinds.filter(
      (kind): kind is OntologyEntityKind =>
        typeof kind === "string" && ONTOLOGY_G6_ENTITY_KINDS.includes(kind as OntologyEntityKind),
    );
  }
  if (typeof record.showNodeLabels === "boolean") options.showNodeLabels = record.showNodeLabels;
  if (typeof record.showEdgeLabels === "boolean") options.showEdgeLabels = record.showEdgeLabels;
  if (typeof record.showEdgeArrows === "boolean") options.showEdgeArrows = record.showEdgeArrows;

  return options;
}

function loadViewPreferences(sourceKey: string): OntologyViewPreferences {
  const storage = getLocalStorage();
  if (!storage) return {};

  try {
    const raw = storage.getItem(`${VIEW_PREFERENCES_PREFIX}${sourceKey}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      layoutMode: isLayoutMode(parsed.layoutMode) ? parsed.layoutMode : undefined,
      adapterOptions: normalizeAdapterOptions(parsed.adapterOptions),
    };
  } catch {
    return {};
  }
}

function saveViewPreferences(sourceKey: string, preferences: OntologyViewPreferences) {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(`${VIEW_PREFERENCES_PREFIX}${sourceKey}`, JSON.stringify(preferences));
  } catch {
    // Storage may be unavailable or full; visualization should continue without persistence.
  }
}

function applyViewPreferences(
  preferences: OntologyViewPreferences,
  setLayoutMode: (value: OntologyG6LayoutMode) => void,
  setAdapterOptions: (value: OntologyG6AdapterOptions) => void,
) {
  setLayoutMode(preferences.layoutMode ?? DEFAULT_LAYOUT_MODE);
  setAdapterOptions(preferences.adapterOptions ?? {});
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

export function OntologyVizApp({ defaultSource }: OntologyVizAppProps) {
  const normalizedDefaultSource = useMemo(
    () => defaultSource ? normalizeSource(defaultSource) : undefined,
    [defaultSource],
  );
  const [loadState, setLoadState] = useState<LoadState>(() =>
    normalizedDefaultSource ? { status: "loading" } : { status: "idle" },
  );
  const [selection, setSelection] = useState<SelectionState>();
  const [focusedElementId, setFocusedElementId] = useState<string>();
  const [layoutMode, setLayoutMode] = useState<OntologyG6LayoutMode>(DEFAULT_LAYOUT_MODE);
  const [adapterOptions, setAdapterOptions] = useState<OntologyG6AdapterOptions>({});
  const graphPlugins = useMemo(() => createG6StandalonePlugins(), []);

  const searchOptions = useMemo<OntologySearchOption[]>(() => {
    if (loadState.status !== "ready") return [];
    return loadState.data.entities.map((entity) => ({
      id: entity.id,
      label: getOntologyDefaultLabel(entity),
      description: entity.localName,
    }));
  }, [loadState]);

  const detailItem = useMemo<OntologyDetailItem | undefined>(() => {
    if (loadState.status !== "ready" || !selection) return undefined;
    if (selection.type === "node") {
      const entity = loadState.data.entities.find((item) => item.id === selection.id);
      return entity ? { type: "entity", entity } : undefined;
    }
    const edge = loadState.data.edges.find((item) => item.id === selection.id);
    return edge ? { type: "edge", edge } : undefined;
  }, [loadState, selection]);

  const availableEntityKinds = useMemo<OntologyEntityKind[]>(() => {
    if (loadState.status !== "ready") return [];
    return Object.entries(loadState.data.stats)
      .filter(([, count]) => count > 0)
      .map(([kind]) => kind as OntologyEntityKind);
  }, [loadState]);

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
        const parseOptions: OntologyParseOptions = {
          ...source.parseOptions,
          contentType: source.parseOptions?.contentType
            ?? contentTypeFromResponse(response.headers.get("content-type"), source.url),
          ontologyTitleFallback: source.parseOptions?.ontologyTitleFallback
            ?? titleFromPath(source.url),
        };
        if (!cancelled) {
          const sourceKey = sourceKeyFromSource(source);
          applyViewPreferences(loadViewPreferences(sourceKey), setLayoutMode, setAdapterOptions);
          setLoadState({
            status: "ready",
            data: parseOntology(content, parseOptions),
            sourceKey,
          });
          setSelection(undefined);
          setFocusedElementId(undefined);
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
      const sourceKey = sourceKeyFromFile(file, content);
      const parseOptions: OntologyParseOptions = {
        contentType: contentTypeFromName(file.name),
        ontologyTitleFallback: titleFromPath(file.name),
      };
      applyViewPreferences(loadViewPreferences(sourceKey), setLayoutMode, setAdapterOptions);
      setLoadState({
        status: "ready",
        data: parseOntology(content, parseOptions),
        sourceKey,
      });
      setSelection(undefined);
      setFocusedElementId(undefined);
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      event.currentTarget.value = "";
    }
  }, []);

  useEffect(() => {
    if (loadState.status !== "ready") return;
    saveViewPreferences(loadState.sourceKey, {
      layoutMode,
      adapterOptions,
    });
  }, [adapterOptions, layoutMode, loadState]);

  if (loadState.status === "ready") {
    return (
      <div className="ontology-viz-app">
        <div className="ontology-viz-standalone">
          <header className="ontology-viz-standalone__header">
            <div className="ontology-viz-standalone__title">
              <strong>OntologyViz</strong>
              <span>{loadState.data.ontologyTitle}</span>
            </div>
            <div className="ontology-viz-standalone__meta">
              <span>节点 {loadState.data.entities.length}</span>
              <span>边 {loadState.data.edges.length}</span>
              {selection && <span>{selection.type} {selection.id}</span>}
            </div>
            <OntologySearchBox
              options={searchOptions}
              onSelect={(id) => {
                setSelection({ type: "node", id });
                setFocusedElementId(id);
              }}
            />
            <OntologyLayoutControl value={layoutMode} onChange={setLayoutMode} />
            <OntologyVisualSettings
              value={adapterOptions}
              availableEntityKinds={availableEntityKinds}
              onChange={setAdapterOptions}
            />
            <ImportButton onChange={handleImport} />
          </header>
          <OntologyGraphCanvas
            data={loadState.data}
            adapterOptions={adapterOptions}
            layoutMode={layoutMode}
            plugins={graphPlugins}
            focusedElementId={focusedElementId}
            selectedElementId={selection?.id}
            onNodeSelect={(id) => setSelection({ type: "node", id })}
            onEdgeSelect={(id) => setSelection({ type: "edge", id })}
            onCanvasClick={() => {
              setSelection(undefined);
              setFocusedElementId(undefined);
            }}
          />
          <OntologyDetailPanel
            item={detailItem}
            onClose={() => {
              setSelection(undefined);
              setFocusedElementId(undefined);
            }}
          />
        </div>
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
