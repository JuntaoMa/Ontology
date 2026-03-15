import { getDemoManifest, runAgentSimulation } from "./engine.mjs";
import { getScenarioById, scenarios } from "./data.mjs";

const manifest = getDemoManifest();

const scenarioSelect = document.querySelector("#scenario-select");
const questionInput = document.querySelector("#question-input");
const runButton = document.querySelector("#run-button");
const resetButton = document.querySelector("#reset-button");
const scenarioOverview = document.querySelector("#scenario-overview");
const runtimeSnapshot = document.querySelector("#runtime-snapshot");
const intentView = document.querySelector("#intent-view");
const assumptionsView = document.querySelector("#assumptions-view");
const answerView = document.querySelector("#answer-view");
const objectTypeView = document.querySelector("#object-type-view");
const capabilityGraph = document.querySelector("#capability-graph");
const traceView = document.querySelector("#trace-view");
const evidenceView = document.querySelector("#evidence-view");
const reportSummary = document.querySelector("#report-summary");
const reportOptions = document.querySelector("#report-options");
const reportJson = document.querySelector("#report-json");

function formatCurrency(value) {
  return `${value.toLocaleString("zh-CN")} RMB`;
}

function optionMarkup(option, recommendedBatch) {
  return `
    <tr class="${option.startBatch === recommendedBatch ? "recommended" : ""}">
      <td>${option.startBatch}</td>
      <td>${option.waitHours}</td>
      <td>${formatCurrency(option.waitCost)}</td>
      <td>${formatCurrency(option.scrapCost)}</td>
      <td>${formatCurrency(option.reworkCost)}</td>
      <td>${formatCurrency(option.expediteCost)}</td>
      <td><span class="cost-badge">${formatCurrency(option.totalCost)}</span></td>
    </tr>
  `;
}

function fillScenarioOptions() {
  scenarioSelect.innerHTML = scenarios
    .map((scenario) => `<option value="${scenario.id}">${scenario.name}</option>`)
    .join("");
}

function renderScenarioMetadata(scenario) {
  scenarioOverview.textContent = scenario.overview;
  runtimeSnapshot.innerHTML = `
    <div class="runtime-grid">
      <article class="runtime-card">
        <strong>设计变更</strong>
        <p>${scenario.engineeringChange.id}</p>
        <p>${scenario.engineeringChange.oldPartRevision} → ${scenario.engineeringChange.newPartRevision}</p>
        <p>${scenario.engineeringChange.effectivityRule}</p>
      </article>
      <article class="runtime-card">
        <strong>供应快照</strong>
        <p>旧件库存：${scenario.supply.oldInventoryQty} 件</p>
        <p>可转移旧件：${scenario.supply.reallocatableOldQty} 件</p>
        <p>新件 ETA：${scenario.supply.newPartEta}</p>
      </article>
      <article class="runtime-card">
        <strong>批次概览</strong>
        <p>${scenario.productionBatches.map((batch) => `${batch.id}(${batch.currentStation})`).join("、")}</p>
        <p>每批需求：${scenario.batchDemandQty} 件</p>
      </article>
    </div>
  `;
}

function renderIntent(result) {
  if (result.status !== "ok") {
    intentView.textContent = result.message;
    assumptionsView.innerHTML = "";
    answerView.textContent = "";
    return;
  }

  intentView.textContent = JSON.stringify(result.businessIntent, null, 2);
  assumptionsView.innerHTML = result.report.assumptions.map((item) => `<li>${item}</li>`).join("");
  answerView.textContent = result.answer;
}

function renderOntologyContext(result) {
  if (result.status !== "ok") {
    objectTypeView.innerHTML = `<div class="error-card">${result.message}</div>`;
    capabilityGraph.innerHTML = "";
    return;
  }

  const objectCards = result.ontologyContext.matchedObjectTypes
    .map((typeId) => manifest.ontologySchema.objectTypes.find((item) => item.id === typeId))
    .filter(Boolean)
    .map(
      (item) => `
        <article class="tag-card">
          <strong>${item.name}</strong>
          <p>${item.id}</p>
          <p>${item.description}</p>
        </article>
      `,
    )
    .join("");
  objectTypeView.innerHTML = objectCards;

  const action = result.ontologyContext.matchedActionSpec;
  const functions = result.ontologyContext.matchedFunctions;
  capabilityGraph.innerHTML = `
    <div class="flow-action">
      <strong>${action.name}</strong>
      <p>${action.id}</p>
      <p>${action.summary}</p>
    </div>
    <div class="flow-arrow">↓</div>
    ${functions
      .map(
        (spec, index) => `
          <div class="flow-function">
            <strong>${index + 1}. ${spec.name}</strong>
            <p>${spec.id}</p>
            <p>${spec.summary}</p>
          </div>
          ${index < functions.length - 1 ? '<div class="flow-arrow">↓</div>' : ""}
        `,
      )
      .join("")}
    <div class="flow-arrow">↓</div>
    <div class="flow-artifact">
      <strong>切换成本报告</strong>
      <p>CutoverCostReport</p>
      <p>对每个候选批次给出成本拆分、推荐结果与证据链。</p>
    </div>
  `;
}

function renderTrace(result) {
  if (result.status !== "ok") {
    traceView.innerHTML = "";
    return;
  }

  traceView.innerHTML = result.trace
    .map(
      (step) => `
        <li class="trace-item">
          <header>
            <strong>${step.label}</strong>
            <span class="trace-kind">${step.kind}</span>
          </header>
          <pre>输入:
${JSON.stringify(step.inputs, null, 2)}

输出:
${JSON.stringify(step.output, null, 2)}</pre>
        </li>
      `,
    )
    .join("");
}

function renderEvidence(result) {
  if (result.status !== "ok") {
    evidenceView.innerHTML = "";
    return;
  }

  evidenceView.innerHTML = result.evidenceBundle
    .map(
      (evidence) => `
        <article class="evidence-card">
          <strong>${evidence.title}</strong>
          <p>${evidence.statement}</p>
          <p>来源类型：${evidence.sourceType}</p>
          <p>关联引用：${evidence.refs.join("、")}</p>
        </article>
      `,
    )
    .join("");
}

function renderReport(result) {
  if (result.status !== "ok") {
    reportSummary.innerHTML = `<div class="error-card">${result.message}</div>`;
    reportOptions.innerHTML = "";
    reportJson.textContent = "";
    return;
  }

  const report = result.report;
  reportSummary.innerHTML = `
    <strong>${report.changeId}</strong>
    <p>${report.summary}</p>
    <p>推荐切换批次：<strong>${report.recommendedCutoverBatch}</strong></p>
    <p>${report.reasoning.join(" / ")}</p>
  `;
  reportOptions.innerHTML = report.options.map((option) => optionMarkup(option, report.recommendedCutoverBatch)).join("");
  reportJson.textContent = JSON.stringify(report, null, 2);
}

function runCurrentScenario() {
  const scenario = getScenarioById(scenarioSelect.value);
  const question = questionInput.value.trim() || scenario.defaultQuestion;
  const result = runAgentSimulation(question, scenario.id);
  renderScenarioMetadata(scenario);
  renderIntent(result);
  renderOntologyContext(result);
  renderTrace(result);
  renderEvidence(result);
  renderReport(result);
}

scenarioSelect.addEventListener("change", () => {
  const scenario = getScenarioById(scenarioSelect.value);
  questionInput.value = scenario.defaultQuestion;
  runCurrentScenario();
});

runButton.addEventListener("click", runCurrentScenario);
resetButton.addEventListener("click", () => {
  const scenario = getScenarioById(scenarioSelect.value);
  questionInput.value = scenario.defaultQuestion;
  runCurrentScenario();
});

fillScenarioOptions();
scenarioSelect.value = scenarios[0].id;
questionInput.value = scenarios[0].defaultQuestion;
runCurrentScenario();
