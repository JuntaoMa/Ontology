const REGISTRY_URL = "./ontology-validator-registry.json";

const state = {
  registry: null,
  view: "core",
  query: "",
  chapter: "all",
  authority: "all",
  cost: "all",
  nodes: new Map(),
  validatorIndex: new Map(),
};

const elements = {
  principles: document.querySelector("#principles"),
  designElements: document.querySelector("#design-elements"),
  scopeAtlas: document.querySelector("#scope-atlas"),
  relationTypes: document.querySelector("#relation-types"),
  validatorRelations: document.querySelector("#validator-relations"),
  readinessRule: document.querySelector("#readiness-rule"),
  dagCanvas: document.querySelector("#dag-canvas"),
  dagPolicies: document.querySelector("#dag-policies"),
  failureRoutes: document.querySelector("#failure-routes"),
  pipeline: document.querySelector("#pipeline"),
  chapters: document.querySelector("#chapters"),
  authorityLegend: document.querySelector("#authority-legend"),
  costLegend: document.querySelector("#cost-legend"),
  chapterSelect: document.querySelector("#chapter-select"),
  authoritySelect: document.querySelector("#authority-select"),
  costSelect: document.querySelector("#cost-select"),
  searchInput: document.querySelector("#search-input"),
  resultCount: document.querySelector("#result-count"),
  resetButton: document.querySelector("#reset-button"),
  printButton: document.querySelector("#print-button"),
  tooltip: document.querySelector("#node-tooltip"),
  dialog: document.querySelector("#node-dialog"),
  dialogContent: document.querySelector("#dialog-content"),
  referenceList: document.querySelector("#reference-list"),
};

const costColors = {
  low: "var(--cost-low)",
  medium: "var(--cost-medium)",
  high: "var(--cost-high)",
  research: "var(--cost-research)",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function validateRegistry(registry) {
  const requiredAuthorities = ["veto", "score", "advise", "human"];
  const requiredCosts = ["low", "medium", "high", "research"];
  const ids = new Set();
  const dagIds = new Set();
  let validatorCount = 0;
  let coreCount = 0;

  if (!registry || !Array.isArray(registry.chapters) || registry.chapters.length === 0) {
    throw new Error("Registry has no chapters");
  }
  if (!Array.isArray(registry.designElements) || registry.designElements.length === 0) {
    throw new Error("Registry has no validator design model");
  }
  if (!registry.scopes || !registry.relationTypes || !registry.orchestration) {
    throw new Error("Registry has no orchestration model");
  }
  for (const key of requiredAuthorities) {
    if (!registry.authorities?.[key]) throw new Error(`Missing authority: ${key}`);
  }
  for (const key of requiredCosts) {
    if (!registry.costs?.[key]) throw new Error(`Missing cost: ${key}`);
  }
  for (const chapter of registry.chapters) {
    if (!Array.isArray(chapter.validators)) throw new Error(`Invalid chapter: ${chapter.id}`);
    if (!registry.scopes[chapter.scope]) throw new Error(`Invalid chapter scope: ${chapter.id}`);
    for (const node of chapter.validators) {
      if (ids.has(node.id)) throw new Error(`Duplicate validator id: ${node.id}`);
      ids.add(node.id);
      validatorCount += 1;
      if (node.core) coreCount += 1;
      if (!registry.authorities[node.authority]) throw new Error(`Invalid authority: ${node.id}`);
      if (!registry.costs[node.cost]) throw new Error(`Invalid cost: ${node.id}`);
      if (node.scope && !registry.scopes[node.scope]) throw new Error(`Invalid scope: ${node.id}`);
      if (Object.hasOwn(node, "status")) throw new Error(`Status is not allowed: ${node.id}`);
    }
  }

  for (const phase of registry.orchestration.phases ?? []) {
    for (const node of phase.nodes ?? []) {
      if (dagIds.has(node.id)) throw new Error(`Duplicate DAG node id: ${node.id}`);
      dagIds.add(node.id);
      if (!registry.scopes[node.scope]) throw new Error(`Invalid DAG scope: ${node.id}`);
      if (!registry.authorities[node.authority]) throw new Error(`Invalid DAG authority: ${node.id}`);
      for (const ref of node.validatorRefs ?? []) {
        if (!ids.has(ref)) throw new Error(`Unknown validator ref: ${node.id} -> ${ref}`);
      }
    }
  }
  const dagNodeById = new Map(
    registry.orchestration.phases.flatMap((phase) => phase.nodes).map((node) => [node.id, node]),
  );
  for (const node of dagNodeById.values()) {
    for (const dependency of [...node.dependsOn, ...node.conditionalOn]) {
      if (!dagIds.has(dependency)) throw new Error(`Unknown DAG dependency: ${node.id} -> ${dependency}`);
      if (dependency === node.id) throw new Error(`Self-dependent DAG node: ${node.id}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visitDag(nodeId) {
    if (visiting.has(nodeId)) throw new Error(`DAG cycle detected at: ${nodeId}`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    const node = dagNodeById.get(nodeId);
    for (const dependency of [...node.dependsOn, ...node.conditionalOn]) visitDag(dependency);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  for (const nodeId of dagIds) visitDag(nodeId);

  for (const relation of registry.orchestration.validatorRelations ?? []) {
    if (!ids.has(relation.from) || !ids.has(relation.to)) {
      throw new Error(`Unknown validator relation: ${relation.from} -> ${relation.to}`);
    }
    if (!registry.relationTypes[relation.type]) throw new Error(`Unknown relation type: ${relation.type}`);
  }
  if (registry.counts.chapters !== registry.chapters.length) throw new Error("Chapter count mismatch");
  if (registry.counts.validators !== validatorCount) throw new Error("Validator count mismatch");
  if (registry.counts.coreValidators !== coreCount) throw new Error("Core count mismatch");
}

function resolvedScope(node, chapter) {
  return state.registry.scopes[node.scope ?? chapter.scope];
}

function authorityColor(node) {
  return state.registry.authorities[node.authority].color;
}

function nodeDetail(node, chapter, headingId = "") {
  const authority = state.registry.authorities[node.authority];
  const cost = state.registry.costs[node.cost];
  const scope = resolvedScope(node, chapter);
  const headingAttribute = headingId ? ` id="${escapeHtml(headingId)}"` : "";
  return `
    <div class="detail-heading">
      <div>
        <span class="node-code">${escapeHtml(node.code)} · ${escapeHtml(node.id)}</span>
        <h3${headingAttribute}>${escapeHtml(node.label)}</h3>
      </div>
      <span class="cost-mark" style="--cost-color:${costColors[node.cost]}">${escapeHtml(cost.label)}</span>
    </div>
    ${node.term ? `<p class="detail-term">${escapeHtml(node.term)}</p>` : ""}
    <div class="detail-meta">
      <span style="border-color:${authority.color};color:${authority.color}">${escapeHtml(authority.label)} · ${escapeHtml(authority.term)}</span>
      <span>${escapeHtml(scope.code)} · ${escapeHtml(scope.label)}</span>
      <span>权限流 ${escapeHtml(node.authorityPlan)}</span>
      <span>${escapeHtml(cost.label)}</span>
    </div>
    <div class="detail-block">
      <h4>作用域边界</h4>
      <p>${escapeHtml(scope.description)}</p>
    </div>
    <div class="detail-block">
      <h4>核心判据</h4>
      <p>${escapeHtml(node.criterion)}</p>
    </div>
    <div class="detail-block">
      <h4>可行方法</h4>
      <p>${escapeHtml(node.method)}</p>
    </div>
    <div class="detail-block">
      <h4>权限边界</h4>
      <p>${escapeHtml(authority.description)}</p>
    </div>
    <div class="detail-block">
      <h4>成本含义</h4>
      <p>${escapeHtml(cost.description)}</p>
    </div>
  `;
}

function renderHeader() {
  const registry = state.registry;
  document.title = registry.title;
  document.querySelector("#page-title").textContent = registry.title;
  document.querySelector("#page-subtitle").textContent = registry.subtitle;
  document.querySelector("#metric-chapters").textContent = registry.counts.chapters;
  document.querySelector("#metric-validators").textContent = registry.counts.validators;
  document.querySelector("#metric-core").textContent = registry.counts.coreValidators;
  document.querySelector("#registry-date").textContent = `设计基线 ${registry.updated}`;
}

function renderPrinciples() {
  elements.principles.innerHTML = state.registry.principles
    .map(
      (principle, index) => `
        <article class="principle-item">
          <h3>${String(index + 1).padStart(2, "0")} · ${escapeHtml(principle.title)}</h3>
          <p>${escapeHtml(principle.text)}</p>
        </article>
      `,
    )
    .join("");
}

function renderDesignModel() {
  elements.designElements.innerHTML = state.registry.designElements
    .map(
      (item, index) => `
        <article class="design-element">
          <div class="design-element__index">${String(index + 1).padStart(2, "0")}</div>
          <div>
            <h3>${escapeHtml(item.label)} <span>${escapeHtml(item.term)}</span></h3>
            <strong>${escapeHtml(item.question)}</strong>
            <p>${escapeHtml(item.contract)}</p>
          </div>
        </article>
      `,
    )
    .join("");

  elements.scopeAtlas.innerHTML = Object.entries(state.registry.scopes)
    .map(
      ([key, scope]) => `
        <span class="scope-item" title="${escapeHtml(scope.description)}" data-scope="${escapeHtml(key)}">
          <b>${escapeHtml(scope.code)}</b>
          <span>${escapeHtml(scope.label)}</span>
        </span>
      `,
    )
    .join("");
}

function validatorLabel(validatorId) {
  const context = state.validatorIndex.get(validatorId);
  return context ? `${context.node.code} · ${context.node.label}` : validatorId;
}

function renderRelations() {
  elements.relationTypes.innerHTML = Object.entries(state.registry.relationTypes)
    .map(
      ([key, relation]) => `
        <article class="relation-type">
          <span class="relation-line relation-line--${escapeHtml(relation.style)}" aria-hidden="true"></span>
          <div>
            <h3>${escapeHtml(relation.label)} <span>${escapeHtml(relation.term)}</span></h3>
            <p>${escapeHtml(relation.description)}</p>
          </div>
        </article>
      `,
    )
    .join("");

  elements.validatorRelations.innerHTML = state.registry.orchestration.validatorRelations
    .map((relation) => {
      const relationType = state.registry.relationTypes[relation.type];
      return `
        <article class="relation-example">
          <div class="relation-example__flow">
            <span class="relation-node">${escapeHtml(validatorLabel(relation.from))}</span>
            <span class="relation-edge relation-edge--${escapeHtml(relationType.style)}">
              ${escapeHtml(relationType.label)}
            </span>
            <span class="relation-node">${escapeHtml(validatorLabel(relation.to))}</span>
          </div>
          <p>${escapeHtml(relation.reason)}</p>
        </article>
      `;
    })
    .join("");
}

function renderDag() {
  const orchestration = state.registry.orchestration;
  const dagNodeById = new Map(
    orchestration.phases.flatMap((phase) => phase.nodes).map((node) => [node.id, node]),
  );
  elements.readinessRule.textContent = orchestration.readinessRule;
  elements.dagCanvas.innerHTML = orchestration.phases
    .map(
      (phase) => `
        <section class="dag-phase" data-phase="${escapeHtml(phase.id)}">
          <header class="dag-phase__head">
            <span>${String(phase.order).padStart(2, "0")} · ${escapeHtml(phase.term)}</span>
            <h3>${escapeHtml(phase.title)}</h3>
          </header>
          <div class="dag-phase__nodes">
            ${phase.nodes
              .map((node) => {
                const authority = state.registry.authorities[node.authority];
                const scope = state.registry.scopes[node.scope];
                const dependencies = node.dependsOn
                  .map((id) => `<span class="dag-dependency">← ${escapeHtml(dagNodeById.get(id).label)}</span>`)
                  .join("");
                const conditional = node.conditionalOn
                  .map((id) => `<span class="dag-dependency dag-dependency--conditional">◇ ${escapeHtml(dagNodeById.get(id).label)}</span>`)
                  .join("");
                return `
                  <article class="dag-node" style="--authority-color:${authority.color}">
                    <div class="dag-node__top">
                      <span class="scope-chip">${escapeHtml(scope.code)} · ${escapeHtml(scope.label)}</span>
                      <span class="dag-authority">${escapeHtml(authority.code)}</span>
                    </div>
                    <h4>${escapeHtml(node.label)}</h4>
                    <p>${escapeHtml(node.description)}</p>
                    <div class="dag-node__meta">${node.validatorRefs.length} 个原子校验器</div>
                    ${dependencies || conditional ? `<div class="dag-dependencies">${dependencies}${conditional}</div>` : ""}
                  </article>
                `;
              })
              .join("")}
          </div>
        </section>
      `,
    )
    .join("");

  elements.dagPolicies.innerHTML = orchestration.policies
    .map(
      (policy, index) => `
        <article class="policy-item">
          <span>${String(index + 1).padStart(2, "0")}</span>
          <h4>${escapeHtml(policy.title)}</h4>
          <small>${escapeHtml(policy.term)}</small>
          <p>${escapeHtml(policy.text)}</p>
        </article>
      `,
    )
    .join("");

  elements.failureRoutes.innerHTML = orchestration.failureRoutes
    .map((route) => {
      const tone = state.registry.authorities[route.tone];
      return `
        <article class="failure-route" style="--route-color:${tone.color}">
          <div>
            <strong>${escapeHtml(route.verdict)}</strong>
            <span>${escapeHtml(route.label)}</span>
          </div>
          <p>${escapeHtml(route.route)}</p>
        </article>
      `;
    })
    .join("");
}

function renderPipeline() {
  elements.pipeline.innerHTML = state.registry.chapters
    .map((chapter) => {
      const core = chapter.validators.filter((node) => node.core).length;
      return `
        <button class="pipeline-stage" type="button" data-scroll-chapter="${escapeHtml(chapter.id)}">
          <span class="pipeline-stage__number">${String(chapter.order).padStart(2, "0")}</span>
          <span class="pipeline-stage__label">${escapeHtml(chapter.shortTitle)}</span>
          <span class="pipeline-stage__count">${core} 核心 / ${chapter.validators.length} 完整</span>
        </button>
      `;
    })
    .join("");
}

function renderLegends() {
  elements.authorityLegend.innerHTML = Object.entries(state.registry.authorities)
    .map(
      ([key, item]) => `
        <span class="legend-item" title="${escapeHtml(item.description)}">
          <span class="legend-swatch" style="--legend-color:${item.color}"></span>
          ${escapeHtml(item.code)} · ${escapeHtml(item.label)}
        </span>
      `,
    )
    .join("");

  elements.costLegend.innerHTML = Object.entries(state.registry.costs)
    .map(
      ([key, item]) => `
        <span class="legend-item" title="${escapeHtml(item.description)}">
          <span class="cost-mark" style="--cost-color:${costColors[key]}">${escapeHtml(item.label)}</span>
        </span>
      `,
    )
    .join("");
}

function renderFilterOptions() {
  for (const chapter of state.registry.chapters) {
    elements.chapterSelect.insertAdjacentHTML(
      "beforeend",
      `<option value="${escapeHtml(chapter.id)}">${String(chapter.order).padStart(2, "0")} · ${escapeHtml(chapter.shortTitle)}</option>`,
    );
  }
  for (const [key, authority] of Object.entries(state.registry.authorities)) {
    elements.authoritySelect.insertAdjacentHTML(
      "beforeend",
      `<option value="${key}">${escapeHtml(authority.code)} · ${escapeHtml(authority.label)}</option>`,
    );
  }
  for (const [key, cost] of Object.entries(state.registry.costs)) {
    elements.costSelect.insertAdjacentHTML(
      "beforeend",
      `<option value="${key}">${escapeHtml(cost.label)}</option>`,
    );
  }
}

function searchableText(chapter, node) {
  const scope = resolvedScope(node, chapter);
  return [chapter.title, chapter.summary, scope.code, scope.label, scope.term, node.code, node.label, node.term, node.criterion, node.method]
    .join(" ")
    .toLocaleLowerCase("zh-CN");
}

function filteredChapters() {
  const query = state.query.trim().toLocaleLowerCase("zh-CN");
  return state.registry.chapters
    .filter((chapter) => state.chapter === "all" || chapter.id === state.chapter)
    .map((chapter) => ({
      ...chapter,
      validators: chapter.validators.filter((node) => {
        if (state.view === "core" && !node.core) return false;
        if (state.authority !== "all" && node.authority !== state.authority) return false;
        if (state.cost !== "all" && node.cost !== state.cost) return false;
        if (query && !searchableText(chapter, node).includes(query)) return false;
        return true;
      }),
    }))
    .filter((chapter) => chapter.validators.length > 0);
}

function nodeCard(chapter, node) {
  const authority = state.registry.authorities[node.authority];
  const cost = state.registry.costs[node.cost];
  const scope = resolvedScope(node, chapter);
  state.nodes.set(node.id, { node, chapter });
  return `
    <button
      class="node-card"
      type="button"
      data-node-id="${escapeHtml(node.id)}"
      style="--authority-color:${authority.color};--cost-color:${costColors[node.cost]}"
      aria-label="${escapeHtml(node.label)}，${escapeHtml(scope.label)}，${escapeHtml(authority.label)}，${escapeHtml(cost.label)}"
    >
      <span class="node-card__top">
        <span class="node-code">${escapeHtml(node.code)}</span>
        <span class="node-card__top-meta">
          <span class="scope-mini">${escapeHtml(scope.code)}</span>
          <span class="authority-mini">${escapeHtml(node.authorityPlan)}</span>
        </span>
      </span>
      <h3>
        ${escapeHtml(node.label)}
        ${node.term ? `<span class="node-term">${escapeHtml(node.term)}</span>` : ""}
      </h3>
      <span class="node-card__foot">
        <span class="authority-label">
          <span class="authority-dot"></span>
          ${escapeHtml(authority.label)}
        </span>
        <span class="cost-badge">${escapeHtml(cost.label)}</span>
      </span>
    </button>
  `;
}

function renderChapters() {
  state.nodes.clear();
  const chapters = filteredChapters();
  const visibleCount = chapters.reduce((sum, chapter) => sum + chapter.validators.length, 0);

  if (visibleCount === 0) {
    elements.chapters.innerHTML = `
      <section class="empty-state">
        <p class="section-number">NO MATCH</p>
        <h2>没有匹配的校验节点</h2>
        <p>调整关键词、章节、权限或成本筛选。</p>
      </section>
    `;
  } else {
    elements.chapters.innerHTML = chapters
      .map(
        (chapter) => `
          <section class="chapter-section" id="chapter-${escapeHtml(chapter.id)}" data-chapter-id="${escapeHtml(chapter.id)}">
            <div class="page-shell">
              <header class="chapter-head">
                <div class="chapter-index">CHAPTER<strong>${String(chapter.order).padStart(2, "0")}</strong></div>
                <div class="chapter-title"><h2>${escapeHtml(chapter.title)}</h2></div>
                <p class="chapter-summary">${escapeHtml(chapter.summary)}</p>
                <div class="chapter-count">${chapter.validators.length} 个节点</div>
              </header>
              <div class="node-network">
              <div class="node-grid">${chapter.validators.map((node) => nodeCard(chapter, node)).join("")}</div>
              </div>
            </div>
          </section>
        `,
      )
      .join("");
  }

  const viewLabel = state.view === "core" ? "核心视图" : "完整视图";
  elements.resultCount.textContent = `${viewLabel} · ${chapters.length} 章 · ${visibleCount} 个校验节点`;
  bindNodeEvents();
}

function renderReferences() {
  elements.referenceList.innerHTML = state.registry.references
    .map(
      (reference) => `
        <a href="${escapeHtml(reference.url)}" target="_blank" rel="noreferrer">${escapeHtml(reference.label)}</a>
      `,
    )
    .join("");
}

function positionTooltip(card) {
  const tooltip = elements.tooltip;
  const rect = card.getBoundingClientRect();
  const gap = 14;
  const width = Math.min(390, window.innerWidth - 32);
  const estimatedHeight = Math.min(520, tooltip.scrollHeight || 440);
  let left = rect.right + gap;
  if (left + width > window.innerWidth - 16) left = rect.left - width - gap;
  left = Math.max(16, Math.min(left, window.innerWidth - width - 16));
  let top = rect.top - 12;
  if (top + estimatedHeight > window.innerHeight - 16) top = window.innerHeight - estimatedHeight - 16;
  top = Math.max(16, top);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showTooltip(card, context) {
  if (window.matchMedia("(max-width: 840px)").matches) return;
  const { node, chapter } = context;
  elements.tooltip.style.setProperty("--authority-color", authorityColor(node));
  elements.tooltip.innerHTML = nodeDetail(node, chapter);
  elements.tooltip.classList.add("is-visible");
  elements.tooltip.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => positionTooltip(card));
}

function hideTooltip() {
  elements.tooltip.classList.remove("is-visible");
  elements.tooltip.setAttribute("aria-hidden", "true");
}

function openDialog(context) {
  const { node, chapter } = context;
  hideTooltip();
  elements.dialog.style.borderTop = `5px solid ${authorityColor(node)}`;
  elements.dialogContent.innerHTML = nodeDetail(node, chapter, "dialog-title");
  elements.dialog.showModal();
}

function bindNodeEvents() {
  document.querySelectorAll(".node-card").forEach((card) => {
    const context = state.nodes.get(card.dataset.nodeId);
    card.addEventListener("pointerenter", () => showTooltip(card, context));
    card.addEventListener("pointerleave", hideTooltip);
    card.addEventListener("focus", () => showTooltip(card, context));
    card.addEventListener("blur", hideTooltip);
    card.addEventListener("click", () => openDialog(context));
  });
}

function updateViewButtons(activeView) {
  document.querySelectorAll("[data-view]").forEach((button) => {
    const isActive = button.dataset.view === activeView;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function resetFilters() {
  state.view = "core";
  state.query = "";
  state.chapter = "all";
  state.authority = "all";
  state.cost = "all";
  elements.searchInput.value = "";
  elements.chapterSelect.value = "all";
  elements.authoritySelect.value = "all";
  elements.costSelect.value = "all";
  updateViewButtons("core");
  renderChapters();
}

function bindControls() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      updateViewButtons(state.view);
      renderChapters();
    });
  });

  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderChapters();
  });
  elements.chapterSelect.addEventListener("change", (event) => {
    state.chapter = event.target.value;
    renderChapters();
  });
  elements.authoritySelect.addEventListener("change", (event) => {
    state.authority = event.target.value;
    renderChapters();
  });
  elements.costSelect.addEventListener("change", (event) => {
    state.cost = event.target.value;
    renderChapters();
  });
  elements.resetButton.addEventListener("click", resetFilters);
  elements.printButton.addEventListener("click", () => window.print());

  elements.pipeline.addEventListener("click", (event) => {
    const button = event.target.closest("[data-scroll-chapter]");
    if (!button) return;
    const chapterId = button.dataset.scrollChapter;
    if (state.chapter !== "all") {
      state.chapter = "all";
      elements.chapterSelect.value = "all";
      renderChapters();
    }
    requestAnimationFrame(() => {
      document.querySelector(`#chapter-${CSS.escape(chapterId)}`)?.scrollIntoView({ behavior: "smooth" });
    });
  });

  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) elements.dialog.close();
  });
  window.addEventListener("scroll", hideTooltip, { passive: true });
  window.addEventListener("resize", hideTooltip);
}

function showLoadError(error) {
  console.error(error);
  const template = document.querySelector("#load-error-template");
  elements.chapters.replaceChildren(template.content.cloneNode(true));
  elements.resultCount.textContent = "注册表加载失败";
}

async function init() {
  try {
    const response = await fetch(REGISTRY_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Registry request failed: ${response.status}`);
    const registry = await response.json();
    validateRegistry(registry);
    state.registry = registry;
    for (const chapter of registry.chapters) {
      for (const node of chapter.validators) state.validatorIndex.set(node.id, { node, chapter });
    }
    renderHeader();
    renderPrinciples();
    renderDesignModel();
    renderRelations();
    renderDag();
    renderPipeline();
    renderLegends();
    renderFilterOptions();
    renderReferences();
    bindControls();
    renderChapters();
  } catch (error) {
    showLoadError(error);
  }
}

init();
