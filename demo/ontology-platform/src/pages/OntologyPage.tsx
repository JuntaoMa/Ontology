import { useMemo, useState } from "react";
import { AppFrame } from "../components/AppFrame";
import { ResourceDrawer } from "../components/ResourceDrawer";
import { ResourceGraph } from "../components/ResourceGraph";
import { usePlatform } from "../hooks/usePlatformState";
import { applyDraft, getResourceByRef, resourceKey } from "../utils/resources";
import type { GraphMode, ResourceType } from "../utils/types";

const MODES: Array<{ id: GraphMode; label: string }> = [
  { id: "all", label: "全部资源" },
  { id: "semantic", label: "语义面" },
  { id: "capability", label: "能力面" },
];

export function OntologyPage() {
  const { currentBundle, state, selectResource, getDraft } = usePlatform();
  const [mode, setMode] = useState<GraphMode>("all");
  const [search, setSearch] = useState("");
  const [showRuntime, setShowRuntime] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const selectedResource = getResourceByRef(currentBundle, state.selectedResource);
  const selectedDraft = getDraft(currentBundle.domainMeta.id, state.selectedResource.type, state.selectedResource.id);
  const selected = selectedResource ? applyDraft(selectedResource, selectedDraft) : null;

  const stats = useMemo(
    () => [
      { label: "Object", value: currentBundle.objects.length },
      { label: "Link", value: currentBundle.links.length },
      { label: "Function", value: currentBundle.functions.length },
      { label: "Action", value: currentBundle.actions.length },
    ],
    [currentBundle],
  );

  function handleSelect(resourceType: ResourceType | "Link", resourceId: string) {
    if (resourceType === "Link") {
      selectResource("Link", resourceId);
      setDrawerOpen(true);
      return;
    }
    selectResource(resourceType, resourceId);
    setDrawerOpen(true);
  }

  return (
    <AppFrame
      page="ontology"
      eyebrow="02 / 本体查看与管理"
      title="让本体图谱成为主视图，再把细节编辑下沉到抽屉与次级窗口"
      description="当前页以交互式异构图为核心画布，集中呈现 Object、Link、Function、Action 之间的结构和依赖关系。点击节点即可在右侧抽屉查看详情、编辑草稿和审阅逻辑体。"
    >
      <section className="ontology-workspace">
        <div className="graph-layout">
          <div className="graph-card">
            <div className="graph-toolbar">
              <div className="graph-toolbar__metrics">
                {stats.map((item) => (
                  <div key={item.label} className="graph-metric">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>

              <div className="graph-toolbar__controls">
                <input
                  id="ontology-search"
                  name="ontologySearch"
                  className="graph-search"
                  type="search"
                  placeholder="检索资源名、ID 或说明"
                  aria-label="检索资源"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />

                <div className="segmented-control" role="tablist" aria-label="图谱视角">
                  {MODES.map((item) => (
                    <button
                      key={item.id}
                      className={mode === item.id ? "active" : ""}
                      type="button"
                      onClick={() => setMode(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <button className="button-secondary" type="button" onClick={() => setShowRuntime(true)}>
                  运行时
                </button>
              </div>
            </div>

            <ResourceGraph
              bundle={currentBundle}
              mode={mode}
              search={search}
              selectedKey={resourceKey(state.selectedResource.type, state.selectedResource.id)}
              onSelect={handleSelect}
            />
            <div className="graph-legend">
              <span className="legend-item legend-item--object">Object</span>
              <span className="legend-item legend-item--function">Function</span>
              <span className="legend-item legend-item--action">Action</span>
              <span className="legend-item legend-item--semantic-edge">语义边（Link）</span>
              <span className="legend-item legend-item--capability-edge">能力依赖边</span>
            </div>
          </div>

          <aside className="selection-card">
            <div className="selection-card__head">
              <h2>当前选中</h2>
              <span className="panel-badge">Inspector</span>
            </div>
            {selected ? (
              <>
                <div className="selection-card__title">{selected.name}</div>
                <p className="selection-card__summary">{selected.summary}</p>
                <div className="token-cloud">
                  <span className="token">{state.selectedResource.type}</span>
                  <span className="token">{state.selectedResource.id}</span>
                </div>
                <button className="button-primary" type="button" onClick={() => setDrawerOpen(true)}>
                  打开详情抽屉
                </button>
              </>
            ) : (
              <div className="empty-note">点击图谱节点或语义边查看详情。</div>
            )}

            <div className="adjacency-panel">
              <h3>路径摘要</h3>
              <ul className="dense-list">
                {currentBundle.pathTemplates.slice(0, 4).map((item) => (
                  <li key={item.id}>
                    <strong>{item.id}</strong>
                    <span>{item.goal}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </section>

      <ResourceDrawer
        bundle={currentBundle}
        resourceRef={state.selectedResource}
        open={drawerOpen && Boolean(selected)}
        onClose={() => setDrawerOpen(false)}
      />

      {showRuntime ? (
        <div className="drawer-backdrop" onClick={() => setShowRuntime(false)}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="modal-panel__head">
              <div>
                <h2>运行时辅助层</h2>
                <p>统一入口和路径模板用于帮助 agent 发现本体，而不是定义本体本身。</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowRuntime(false)} aria-label="关闭运行时窗口">
                ×
              </button>
            </div>

            <div className="preview-columns">
              <section>
                <h3>统一入口</h3>
                <ul className="dense-list">
                  {currentBundle.entrypoints.map((item) => (
                    <li key={item.id}>
                      <strong>{item.id}</strong>
                      <span>{item.kind} · {item.summary}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>路径模板</h3>
                <ul className="dense-list">
                  {currentBundle.pathTemplates.map((item) => (
                    <li key={item.id}>
                      <strong>{item.id}</strong>
                      <span>{item.goal}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </AppFrame>
  );
}
