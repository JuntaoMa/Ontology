import { useEffect, useRef, useState } from "react";

import { DetailPanel } from "../components/DetailPanel";
import { LayoutDialog } from "../components/LayoutDialog";
import { SearchBox } from "../components/SearchBox";
import {
  GraphCanvas,
} from "../graph/GraphCanvas";
import {
  toGraphData,
  type LayoutMode,
  type LayoutSnapshot,
} from "../graph";
import {
  parseOntology,
  type OntologyDocument,
} from "../ontology";
import {
  listRecentSources,
  readPreferences,
  readRecentSource,
  saveRecentSource,
  writePreferences,
  type StoredSource,
} from "../storage";
import "../styles/app.css";

const DEFAULT_SOURCE = {
  url: `${import.meta.env.BASE_URL}npd-v2-ql.owl`,
  name: "npd-v2-ql.owl",
  key: "bundled:npd-v2-ql:v5",
  layoutUrl: `${import.meta.env.BASE_URL}npd-v2-ql.force-atlas2.layout.json`,
};

interface ReadyState {
  document: OntologyDocument;
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob(
    [JSON.stringify(value, null, 2)],
    { type: "application/json" },
  ));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function normalizedDocument(document: OntologyDocument) {
  return {
    source: document.source,
    ontologyIri: document.ontologyIri,
    displayName: document.displayName,
    prefixes: Object.fromEntries(document.prefixes),
    resources: document.resources,
    graph: document.graph,
  };
}

function AppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="2.5" />
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="19" cy="12" r="2.5" />
      <path d="M7 10.5 10.5 7M13.5 7 17 10.5M7.5 12h9" />
    </svg>
  );
}

export default function App() {
  const [ready, setReady] = useState<ReadyState>();
  const [busy, setBusy] = useState("正在加载本体");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("force-atlas2");
  const [layoutSnapshot, setLayoutSnapshot] = useState<LayoutSnapshot>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recents, setRecents] = useState<StoredSource[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadRevisionRef = useRef(0);

  const refreshRecents = async () => {
    try {
      setRecents(await listRecentSources());
    } catch (storageError) {
      console.warn("[OntologyViz] Unable to read recent sources", storageError);
    }
  };

  const applyDocument = (
    document: OntologyDocument,
    defaultSnapshot?: LayoutSnapshot,
  ) => {
    const preferences = readPreferences(document.source.key);
    setReady({ document });
    setLayoutMode(preferences.layoutMode ?? "force-atlas2");
    setLayoutSnapshot(preferences.layoutSnapshot ?? defaultSnapshot);
    setSelectedId(undefined);
    setSettingsOpen(false);
    setRecentOpen(false);
    setExportOpen(false);
    setError("");
    setBusy("");
  };

  const loadText = async (
    text: string,
    name: string,
    path: string,
    key?: string,
    defaultSnapshot?: LayoutSnapshot,
    remember = true,
  ) => {
    const revision = loadRevisionRef.current + 1;
    loadRevisionRef.current = revision;
    setBusy("正在解析本体");
    setError("");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const document = await parseOntology({ text, name, path, key });
      if (revision !== loadRevisionRef.current) return;
      applyDocument(document, defaultSnapshot);
      if (remember) {
        await saveRecentSource({
          key: document.source.key,
          name,
          path,
          text,
          openedAt: Date.now(),
        });
        await refreshRecents();
      }
    } catch (loadError) {
      if (revision !== loadRevisionRef.current) return;
      setBusy("");
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      console.error(loadError);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [response, layoutResponse] = await Promise.all([
          fetch(DEFAULT_SOURCE.url),
          fetch(DEFAULT_SOURCE.layoutUrl),
        ]);
        if (!response.ok) throw new Error(`默认本体加载失败：${response.status}`);
        const text = await response.text();
        const snapshot = layoutResponse.ok
          ? await layoutResponse.json() as LayoutSnapshot
          : undefined;
        if (!cancelled) {
          await loadText(
            text,
            DEFAULT_SOURCE.name,
            DEFAULT_SOURCE.url,
            DEFAULT_SOURCE.key,
            snapshot,
            false,
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setBusy("");
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    })();
    void refreshRecents();
    return () => {
      cancelled = true;
      loadRevisionRef.current += 1;
    };
  }, []);

  const importFile = async (file?: File) => {
    if (!file) return;
    const path = (file as File & { path?: string }).path || file.webkitRelativePath || file.name;
    await loadText(await file.text(), file.name, path);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openRecent = async (key: string) => {
    const source = await readRecentSource(key);
    if (source) await loadText(source.text, source.name, source.path, source.key);
  };

  const changeLayout = (value: LayoutMode) => {
    if (!ready) return;
    setLayoutMode(value);
    setLayoutSnapshot(undefined);
    writePreferences(ready.document.source.key, { layoutMode: value });
  };

  const persistSnapshot = (snapshot: LayoutSnapshot) => {
    if (!ready) return;
    setLayoutSnapshot(snapshot);
    writePreferences(ready.document.source.key, { layoutMode, layoutSnapshot: snapshot });
  };

  return (
    <div className="app-shell">
      <svg width="0" height="0" aria-hidden="true" focusable="false">
        <symbol id="ontology-settings" viewBox="0 0 24 24">
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.57 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.57 1.7 1.7 0 0 0 10 3V3h4v.08a1.7 1.7 0 0 0 1.06 1.52 1.7 1.7 0 0 0 1.88-.34L17 4.2 19.83 7l-.06.06A1.7 1.7 0 0 0 19.43 9 1.7 1.7 0 0 0 21 10h.08v4H21a1.7 1.7 0 0 0-1.6 1Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
      </svg>

      <header className="app-header">
        <div className="brand">
          <AppIcon />
          <strong>OntologyViz</strong>
        </div>
        <div
          className="document-title"
          title={ready?.document.source.path || DEFAULT_SOURCE.url}
        >
          {ready?.document.displayName || DEFAULT_SOURCE.name}
        </div>
        <div className="header-actions">
          {ready ? (
            <span className="graph-counts">
              节点 {ready.document.graph.nodeIds.length}
              <span>边 {ready.document.graph.edges.length}</span>
            </span>
          ) : null}
          <div className="menu-anchor">
            <button
              type="button"
              className="header-button"
              onClick={() => {
                setRecentOpen((value) => !value);
                setExportOpen(false);
              }}
            >
              最近打开
            </button>
            {recentOpen ? (
              <div className="header-menu recent-menu">
                {recents.length ? recents.map((source) => (
                  <button type="button" key={source.key} onClick={() => void openRecent(source.key)}>
                    <span title={source.path}>{source.name}</span>
                    <time>{new Date(source.openedAt).toLocaleString()}</time>
                  </button>
                )) : <div className="menu-empty">暂无记录</div>}
              </div>
            ) : null}
          </div>
          {ready ? (
            <div className="menu-anchor">
              <button
                type="button"
                className="header-button"
                onClick={() => {
                  setExportOpen((value) => !value);
                  setRecentOpen(false);
                }}
              >
                导出
              </button>
              {exportOpen ? (
                <div className="header-menu export-menu">
                  <button
                    type="button"
                    onClick={() => downloadJson(
                      `${ready.document.source.name}.ontology.json`,
                      normalizedDocument(ready.document),
                    )}
                  >
                    标准化本体 JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadJson(
                      `${ready.document.source.name}.g6.json`,
                      toGraphData(ready.document),
                    )}
                  >
                    G6 JSON
                  </button>
                  {layoutSnapshot ? (
                    <button
                      type="button"
                      onClick={() => downloadJson(
                        `${ready.document.source.name}.layout.json`,
                        layoutSnapshot,
                      )}
                    >
                      布局 JSON
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className="import-button"
            onClick={() => fileInputRef.current?.click()}
          >
            导入本体
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ttl,.n3,.nt,.nq,.trig,.owl,.rdf,.xml"
            hidden
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
        </div>
      </header>

      <main className="workspace" onClick={() => {
        if (recentOpen) setRecentOpen(false);
        if (exportOpen) setExportOpen(false);
      }}>
        {ready ? (
          <>
            <GraphCanvas
              document={ready.document}
              layoutMode={layoutMode}
              layoutSnapshot={layoutSnapshot}
              selectedElementId={selectedId}
              onNodeSelect={(id) => {
                setSettingsOpen(false);
                setSelectedId(id);
              }}
              onEdgeSelect={(id) => {
                setSettingsOpen(false);
                setSelectedId(id);
              }}
              onCanvasClick={() => setSelectedId(undefined)}
              onOpenSettings={() => {
                setSelectedId(undefined);
                setSettingsOpen((value) => !value);
              }}
              onBusyChange={setBusy}
              onLayoutSnapshotChange={persistSnapshot}
            />
            <div className="search-overlay">
              <SearchBox document={ready.document} onSelect={setSelectedId} />
            </div>
            <DetailPanel
              document={ready.document}
              selectedId={selectedId}
              onClose={() => setSelectedId(undefined)}
            />
          </>
        ) : null}

        {busy ? (
          <div className="status-overlay">
            <span className="spinner" />
            <strong>{busy}</strong>
          </div>
        ) : null}
        {error ? (
          <div className="status-overlay status-overlay--error">
            <strong>无法打开本体</strong>
            <p>{error}</p>
            <button type="button" className="import-button" onClick={() => fileInputRef.current?.click()}>
              导入其他本体
            </button>
          </div>
        ) : null}
      </main>

      <LayoutDialog
        open={settingsOpen}
        value={layoutMode}
        onClose={() => setSettingsOpen(false)}
        onChange={changeLayout}
      />
    </div>
  );
}
