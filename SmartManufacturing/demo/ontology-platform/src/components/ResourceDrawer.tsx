import { useEffect, useState } from "react";
import { usePlatform } from "../hooks/usePlatformState";
import { applyDraft, getResourceByRef, joinLines, parseLines } from "../utils/resources";
import type { ActionResource, DomainBundle, FunctionResource, LinkResource, ObjectResource, ResourceReference, ResourceType } from "../utils/types";
import { TypeBadge } from "./TypeBadge";

type DrawerTab = "metadata" | "logic" | "deps";

interface DraftFormState {
  name: string;
  summary: string;
  properties: string;
  identityFields: string;
  mainDisplayFields: string;
  fromObject: string;
  toObject: string;
  cardinality: string;
  inputs: string;
  outputs: string;
  responsibleFor: string;
  notResponsibleFor: string;
  logicText: string;
}

const EMPTY_FORM: DraftFormState = {
  name: "",
  summary: "",
  properties: "",
  identityFields: "",
  mainDisplayFields: "",
  fromObject: "",
  toObject: "",
  cardinality: "",
  inputs: "",
  outputs: "",
  responsibleFor: "",
  notResponsibleFor: "",
  logicText: "",
};

function buildFormState(resource: ObjectResource | LinkResource | FunctionResource | ActionResource, logicText: string): DraftFormState {
  if ("properties" in resource) {
    return {
      ...EMPTY_FORM,
      name: resource.name,
      summary: resource.summary,
      properties: joinLines(resource.properties),
      identityFields: joinLines(resource.identityFields),
      mainDisplayFields: joinLines(resource.mainDisplayFields),
      logicText,
    };
  }

  if ("fromObject" in resource) {
    return {
      ...EMPTY_FORM,
      name: resource.name,
      summary: resource.summary,
      fromObject: resource.fromObject,
      toObject: resource.toObject,
      cardinality: resource.cardinality,
      logicText,
    };
  }

  return {
    ...EMPTY_FORM,
    name: resource.name,
    summary: resource.summary,
    inputs: joinLines(resource.inputs),
    outputs: joinLines(resource.outputs),
    responsibleFor: joinLines(resource.capabilityBoundary.responsibleFor),
    notResponsibleFor: joinLines(resource.capabilityBoundary.notResponsibleFor),
    logicText,
  };
}

function resourceDependencies(resource: ObjectResource | LinkResource | FunctionResource | ActionResource) {
  if ("readsObjects" in resource) {
    return {
      objects: [...resource.readsObjects, ...("anchorObjects" in resource ? resource.anchorObjects : [])],
      links: resource.traversesLinks,
      functions: "dependsOnFunctions" in resource ? resource.dependsOnFunctions : resource.callsFunctions,
    };
  }

  if ("fromObject" in resource) {
    return {
      objects: [resource.fromObject, resource.toObject],
      links: [],
      functions: [],
    };
  }

  return {
    objects: [],
    links: [],
    functions: [],
  };
}

export function ResourceDrawer({
  bundle,
  resourceRef,
  open,
  onClose,
}: {
  bundle: DomainBundle;
  resourceRef: ResourceReference | null;
  open: boolean;
  onClose: () => void;
}) {
  const { getDraft, saveDraft, clearDraft } = usePlatform();
  const [tab, setTab] = useState<DrawerTab>("metadata");
  const [form, setForm] = useState<DraftFormState>(EMPTY_FORM);

  const draft = resourceRef ? getDraft(bundle.domainMeta.id, resourceRef.type, resourceRef.id) : null;
  const original = resourceRef ? getResourceByRef(bundle, resourceRef) : null;
  const resource = original ? applyDraft(original, draft) : null;
  const logicText =
    (draft?.logicText ?? (resourceRef ? bundle.logicTexts[`${resourceRef.type}:${resourceRef.id}`] : "")) || "";

  useEffect(() => {
    if (!resource) {
      setForm(EMPTY_FORM);
      return;
    }
    setForm(buildFormState(resource, logicText));
  }, [resource, logicText]);

  if (!open || !resourceRef || !resource) {
    return null;
  }

  const activeRef = resourceRef;
  const activeResource = resource;
  const activeOriginal = original;

  if (!activeOriginal) {
    return null;
  }

  const dependencies = resourceDependencies(activeResource);

  function handleSave() {
    if ("properties" in activeResource) {
      saveDraft(bundle.domainMeta.id, activeRef.type, activeRef.id, {
        metadata: {
          name: form.name,
          summary: form.summary,
          properties: parseLines(form.properties),
          identityFields: parseLines(form.identityFields),
          mainDisplayFields: parseLines(form.mainDisplayFields),
        },
      });
      return;
    }

    if ("fromObject" in activeResource) {
      saveDraft(bundle.domainMeta.id, activeRef.type, activeRef.id, {
        metadata: {
          name: form.name,
          summary: form.summary,
          fromObject: form.fromObject.trim(),
          toObject: form.toObject.trim(),
          cardinality: form.cardinality.trim(),
        },
      });
      return;
    }

    saveDraft(bundle.domainMeta.id, activeRef.type, activeRef.id, {
      metadata: {
        name: form.name,
        summary: form.summary,
        inputs: parseLines(form.inputs),
        outputs: parseLines(form.outputs),
        capabilityBoundary: {
          responsibleFor: parseLines(form.responsibleFor),
          notResponsibleFor: parseLines(form.notResponsibleFor),
        },
      },
      logicText: form.logicText,
    });
  }

  function handleReset() {
    clearDraft(bundle.domainMeta.id, activeRef.type, activeRef.id);
    setForm(buildFormState(activeOriginal!, bundle.logicTexts[`${activeRef.type}:${activeRef.id}`] || ""));
  }

  const isCapability = activeRef.type === "Function" || activeRef.type === "Action";

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer-panel" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-meta">
              <TypeBadge type={activeRef.type} />
              <span className="drawer-ref">{activeRef.id}</span>
            </div>
            <h2>{activeResource.name}</h2>
            <p>{activeResource.summary}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭详情抽屉">
            ×
          </button>
        </div>

        <div className="drawer-tabs">
          <button className={tab === "metadata" ? "active" : ""} type="button" onClick={() => setTab("metadata")}>
            元数据
          </button>
          <button className={tab === "logic" ? "active" : ""} type="button" onClick={() => setTab("logic")}>
            逻辑体
          </button>
          <button className={tab === "deps" ? "active" : ""} type="button" onClick={() => setTab("deps")}>
            依赖
          </button>
        </div>

        <div className="drawer-content">
          {tab === "metadata" ? (
            <div className="editor-form">
              <label className="field">
                <span>名称</span>
                <input id="drawer-name" name="drawerName" value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} />
              </label>
              <label className="field">
                <span>说明</span>
                <textarea id="drawer-summary" name="drawerSummary" rows={4} value={form.summary} onChange={(event) => setForm((previous) => ({ ...previous, summary: event.target.value }))} />
              </label>

              {"properties" in activeResource ? (
                <>
                  <label className="field">
                    <span>属性</span>
                    <textarea id="drawer-properties" name="drawerProperties" rows={6} value={form.properties} onChange={(event) => setForm((previous) => ({ ...previous, properties: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>身份字段</span>
                    <textarea id="drawer-identity-fields" name="drawerIdentityFields" rows={3} value={form.identityFields} onChange={(event) => setForm((previous) => ({ ...previous, identityFields: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>主展示字段</span>
                    <textarea id="drawer-main-display-fields" name="drawerMainDisplayFields" rows={3} value={form.mainDisplayFields} onChange={(event) => setForm((previous) => ({ ...previous, mainDisplayFields: event.target.value }))} />
                  </label>
                </>
              ) : null}

              {"fromObject" in activeResource ? (
                <div className="field-grid">
                  <label className="field">
                    <span>起点 Object</span>
                    <input id="drawer-from-object" name="drawerFromObject" value={form.fromObject} onChange={(event) => setForm((previous) => ({ ...previous, fromObject: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>终点 Object</span>
                    <input id="drawer-to-object" name="drawerToObject" value={form.toObject} onChange={(event) => setForm((previous) => ({ ...previous, toObject: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>基数</span>
                    <input id="drawer-cardinality" name="drawerCardinality" value={form.cardinality} onChange={(event) => setForm((previous) => ({ ...previous, cardinality: event.target.value }))} />
                  </label>
                </div>
              ) : null}

              {isCapability ? (
                <>
                  <label className="field">
                    <span>输入</span>
                    <textarea id="drawer-inputs" name="drawerInputs" rows={6} value={form.inputs} onChange={(event) => setForm((previous) => ({ ...previous, inputs: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>输出</span>
                    <textarea id="drawer-outputs" name="drawerOutputs" rows={6} value={form.outputs} onChange={(event) => setForm((previous) => ({ ...previous, outputs: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>负责范围</span>
                    <textarea id="drawer-responsible" name="drawerResponsible" rows={4} value={form.responsibleFor} onChange={(event) => setForm((previous) => ({ ...previous, responsibleFor: event.target.value }))} />
                  </label>
                  <label className="field">
                    <span>不负责范围</span>
                    <textarea id="drawer-not-responsible" name="drawerNotResponsible" rows={4} value={form.notResponsibleFor} onChange={(event) => setForm((previous) => ({ ...previous, notResponsibleFor: event.target.value }))} />
                  </label>
                </>
              ) : null}
            </div>
          ) : null}

          {tab === "logic" ? (
            isCapability ? (
              <label className="field">
                <span>结构化中文逻辑体</span>
                <textarea id="drawer-logic" name="drawerLogic" rows={20} value={form.logicText} onChange={(event) => setForm((previous) => ({ ...previous, logicText: event.target.value }))} />
              </label>
            ) : (
              <div className="empty-note">当前资源不包含独立逻辑体。</div>
            )
          ) : null}

          {tab === "deps" ? (
            <div className="dependency-stack">
              <section className="dependency-card">
                <h3>关联 Object</h3>
                <div className="token-cloud">
                  {dependencies.objects.length ? dependencies.objects.map((item) => <span key={item} className="token">{item}</span>) : <span className="empty-note">暂无</span>}
                </div>
              </section>
              <section className="dependency-card">
                <h3>关联 Link</h3>
                <div className="token-cloud">
                  {dependencies.links.length ? dependencies.links.map((item) => <span key={item} className="token">{item}</span>) : <span className="empty-note">暂无</span>}
                </div>
              </section>
              <section className="dependency-card">
                <h3>调用 / 依赖能力</h3>
                <div className="token-cloud">
                  {dependencies.functions.length ? dependencies.functions.map((item) => <span key={item} className="token">{item}</span>) : <span className="empty-note">暂无</span>}
                </div>
              </section>
            </div>
          ) : null}
        </div>

        <div className="drawer-actions">
          <button className="button-secondary" type="button" onClick={handleReset}>
            重置草稿
          </button>
          <button className="button-primary" type="button" onClick={handleSave}>
            保存草稿
          </button>
        </div>
      </aside>
    </div>
  );
}
