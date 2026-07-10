import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";

import {
  getOntologyDefaultLabel,
  parseOntology,
  type OntologyEntityKind,
  type OntologyGraphData,
  type OntologyLayoutPosition,
  type OntologyLayoutSnapshot,
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
import { RecentOntologyMenu } from "../standalone/RecentOntologyMenu";
import {
  listRecentOntologies,
  loadRecentOntology,
  rememberRecentFile,
  rememberRecentUrl,
  touchRecentOntology,
} from "../standalone/recentOntologyStore";

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
  layoutSnapshot?: OntologyLayoutSnapshot;
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

function ontologyLabel(data: OntologyGraphData, fallback: string) {
  return data.ontologyTitle?.trim() || fallback;
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

function normalizeLayoutSnapshot(value: unknown): OntologyLayoutSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!record.nodes || typeof record.nodes !== "object") return undefined;

  const nodes: Record<string, OntologyLayoutPosition> = {};
  for (const [id, rawPosition] of Object.entries(record.nodes as Record<string, unknown>)) {
    if (!rawPosition || typeof rawPosition !== "object") continue;
    const position = rawPosition as Record<string, unknown>;
    if (typeof position.x !== "number" || typeof position.y !== "number") continue;
    nodes[id] = typeof position.z === "number"
      ? { x: position.x, y: position.y, z: position.z }
      : { x: position.x, y: position.y };
  }

  return Object.keys(nodes).length > 0
    ? { nodes, updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : undefined }
    : undefined;
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
      layoutSnapshot: normalizeLayoutSnapshot(parsed.layoutSnapshot),
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
  setLayoutSnapshot: (value: OntologyLayoutSnapshot | undefined) => void,
) {
  setLayoutMode(preferences.layoutMode ?? DEFAULT_LAYOUT_MODE);
  setAdapterOptions(preferences.adapterOptions ?? {});
  setLayoutSnapshot(preferences.layoutSnapshot);
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
  const [layoutSnapshot, setLayoutSnapshot] = useState<OntologyLayoutSnapshot>();
  const [recentEntries, setRecentEntries] = useState(listRecentOntologies);
  const [loadingRecentId, setLoadingRecentId] = useState<string>();
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

  const refreshRecentEntries = useCallback(() => {
    setRecentEntries(listRecentOntologies());
  }, []);

  const commitOntology = useCallback((
    content: string,
    parseOptions: OntologyParseOptions,
    sourceKey: string,
  ) => {
    const data = parseOntology(content, parseOptions);
    applyViewPreferences(
      loadViewPreferences(sourceKey),
      setLayoutMode,
      setAdapterOptions,
      setLayoutSnapshot,
    );
    setLoadState({ status: "ready", data, sourceKey });
    setSelection(undefined);
    setFocusedElementId(undefined);
    return data;
  }, []);

  const loadUrlSource = useCallback(async (
    source: OntologyVizSource,
    signal?: AbortSignal,
  ) => {
    setLoadState({ status: "loading" });
    try {
      const response = await fetch(source.url, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${source.url}: ${response.status}`);
      }
      const content = await response.text();
      if (signal?.aborted) return;

      const parseOptions: OntologyParseOptions = {
        ...source.parseOptions,
        contentType: source.parseOptions?.contentType
          ?? contentTypeFromResponse(response.headers.get("content-type"), source.url),
        ontologyTitleFallback: source.parseOptions?.ontologyTitleFallback
          ?? titleFromPath(source.url),
      };
      const sourceKey = sourceKeyFromSource(source);
      const data = commitOntology(content, parseOptions, sourceKey);
      rememberRecentUrl(sourceKey, ontologyLabel(data, titleFromPath(source.url)), source);
      refreshRecentEntries();
    } catch (error) {
      if (signal?.aborted) return;
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [commitOntology, refreshRecentEntries]);

  useEffect(() => {
    if (!normalizedDefaultSource) {
      setLoadState((current) => current.status === "loading" ? { status: "idle" } : current);
      return;
    }

    const controller = new AbortController();
    void loadUrlSource(normalizedDefaultSource, controller.signal);
    return () => controller.abort();
  }, [loadUrlSource, normalizedDefaultSource]);

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
      const data = commitOntology(content, parseOptions, sourceKey);
      void rememberRecentFile(
        sourceKey,
        ontologyLabel(data, titleFromPath(file.name)),
        content,
        parseOptions,
      ).then((saved) => {
        if (saved) refreshRecentEntries();
      });
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      event.currentTarget.value = "";
    }
  }, [commitOntology, refreshRecentEntries]);

  const handleOpenRecent = useCallback(async (id: string) => {
    setLoadingRecentId(id);
    setLoadState({ status: "loading" });
    try {
      const recent = await loadRecentOntology(id);
      if (!recent) {
        refreshRecentEntries();
        throw new Error("无法读取这个最近打开的本体");
      }
      if (recent.kind === "url") {
        await loadUrlSource(recent.source);
        return;
      }

      const parseOptions: OntologyParseOptions = recent.parseOptions ?? {};
      const data = commitOntology(recent.content, parseOptions, recent.entry.id);
      touchRecentOntology(recent.entry.id, ontologyLabel(data, recent.entry.label));
      refreshRecentEntries();
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoadingRecentId(undefined);
    }
  }, [commitOntology, loadUrlSource, refreshRecentEntries]);

  useEffect(() => {
    if (loadState.status !== "ready") return;
    saveViewPreferences(loadState.sourceKey, {
      layoutMode,
      adapterOptions,
      layoutSnapshot,
    });
  }, [adapterOptions, layoutMode, layoutSnapshot, loadState]);

  const handleLayoutModeChange = useCallback((value: OntologyG6LayoutMode) => {
    setLayoutMode(value);
    setLayoutSnapshot(undefined);
  }, []);

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
            <OntologyLayoutControl value={layoutMode} onChange={handleLayoutModeChange} />
            <OntologyVisualSettings
              value={adapterOptions}
              availableEntityKinds={availableEntityKinds}
              onChange={setAdapterOptions}
            />
            <RecentOntologyMenu
              entries={recentEntries}
              loadingId={loadingRecentId}
              onOpen={(id) => void handleOpenRecent(id)}
            />
            <ImportButton onChange={handleImport} />
          </header>
          <OntologyGraphCanvas
            data={loadState.data}
            adapterOptions={adapterOptions}
            layoutMode={layoutMode}
            plugins={graphPlugins}
            layoutSnapshot={layoutSnapshot}
            focusedElementId={focusedElementId}
            selectedElementId={selection?.id}
            onNodeSelect={(id) => setSelection({ type: "node", id })}
            onEdgeSelect={(id) => setSelection({ type: "edge", id })}
            onLayoutSnapshotChange={setLayoutSnapshot}
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
            <div className="ontology-viz-app-state__actions">
              <RecentOntologyMenu
                entries={recentEntries}
                loadingId={loadingRecentId}
                onOpen={(id) => void handleOpenRecent(id)}
              />
              <ImportButton onChange={handleImport} />
            </div>
          </>
        )}
        {loadState.status === "idle" && (
          <div className="ontology-viz-app-state__actions">
            <RecentOntologyMenu
              entries={recentEntries}
              loadingId={loadingRecentId}
              onOpen={(id) => void handleOpenRecent(id)}
            />
            <ImportButton onChange={handleImport} />
          </div>
        )}
      </div>
    </div>
  );
}
