import { actionSpecs, functionSpecs, getActionSpec, getFunctionSpec, getScenarioById, ontologySchema } from "./data.mjs";

function parseBatchNumber(batchId) {
  const match = batchId.match(/(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function formatHours(hours) {
  return Math.max(0, Math.round(hours));
}

function toDate(value) {
  return new Date(value);
}

function diffHours(later, earlier) {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60);
}

function sum(values) {
  return values.reduce((total, current) => total + current, 0);
}

function buildEvidence(id, title, sourceType, statement, refs = []) {
  return { id, title, sourceType, statement, refs };
}

function supportedAnalysisQuestion(question) {
  return /成本报告|切换成本|推荐.*批次|cost report/i.test(question);
}

function hasUnsupportedExecutionIntent(question, scenario) {
  return scenario.policy.unsupportedIntentKeywords.some((keyword) => question.includes(keyword));
}

function extractChangeId(question) {
  const match = question.match(/ECN-\d+/i);
  return match ? match[0].toUpperCase() : null;
}

function createTraceStep(id, label, kind, inputs, output, evidenceIds = []) {
  return { id, label, kind, inputs, output, evidenceIds };
}

function groundBusinessIntent(question, scenario) {
  const extractedChangeId = extractChangeId(question);
  const assumptions = [];

  if (hasUnsupportedExecutionIntent(question, scenario)) {
    return {
      status: "unsupported",
      message: "当前 Demo 只支持生成切换成本分析报告，不支持直接写回 MES、锁批次或执行变更动作。",
    };
  }

  if (!supportedAnalysisQuestion(question)) {
    return {
      status: "needs_clarification",
      message: "当前 Demo 仅支持“设计变更切换成本分析报告”类问题，请明确说明需要输出成本报告或推荐批次。",
    };
  }

  const changeId = extractedChangeId ?? scenario.engineeringChange.id;
  if (!extractedChangeId) {
    assumptions.push("用户未显式提供设计变更编号，系统默认使用当前案例对应的变更对象。");
  }

  if (changeId !== scenario.engineeringChange.id) {
    return {
      status: "needs_clarification",
      message: `未找到与问题匹配的设计变更 ${changeId}。当前案例仅内置 ${scenario.engineeringChange.id}。`,
    };
  }

  return {
    status: "ok",
    businessIntent: {
      goal: "generate_cutover_cost_report",
      changeId,
      targetOutput: "CutoverCostReport",
      optimizeFor: "total_cost_min",
      domain: "manufacturing_changeover",
      assumptions,
    },
  };
}

function resolveOntologyContext(intent, scenario) {
  const matchedObjectTypes = [
    "EngineeringChange",
    "PartRevision",
    "ProductModel",
    "ProductionBatch",
    "InventoryLot",
    "SupplyArrival",
    "CostRule",
    "ReportArtifact",
  ];

  const matchedRelationTypes = ontologySchema.relationTypes
    .filter((relation) =>
      ["REPLACES", "INTRODUCES", "APPLIES_TO_MODEL", "USED_IN", "CONSUMES", "HAS_WIP_STATE", "INBOUND_FOR", "GOVERNS_SWITCH"].includes(relation.id),
    )
    .map((relation) => relation.id);

  const actionSpec = getActionSpec("create_cutover_cost_analysis");
  const matchedFunctions = actionSpec.callsFunctions.map(getFunctionSpec).filter(Boolean);

  const capabilityGraph = {
    nodes: [
      { id: actionSpec.id, kind: "action", label: actionSpec.name },
      ...matchedFunctions.map((spec) => ({ id: spec.id, kind: "function", label: spec.name })),
      { id: "CutoverCostReport", kind: "artifact", label: "切换成本报告" },
    ],
    edges: [
      ...matchedFunctions.map((spec) => ({ from: actionSpec.id, to: spec.id, type: "CALLS" })),
      { from: "build_cutover_cost_report", to: "CutoverCostReport", type: "PRODUCES" },
    ],
  };

  return {
    intent,
    matchedObjectTypes,
    matchedRelationTypes,
    matchedFunctions,
    matchedActionSpec: actionSpec,
    capabilityGraph,
    summary: `已识别为制造设计变更切换成本分析问题，命中 ${matchedObjectTypes.length} 类对象和 ${matchedFunctions.length} 个函数能力。`,
  };
}

function resolveChangeScope(scenario) {
  return {
    productModel: scenario.productModel.id,
    bomNode: scenario.bomNode.id,
    oldPartRevision: scenario.engineeringChange.oldPartRevision,
    newPartRevision: scenario.engineeringChange.newPartRevision,
  };
}

function resolveImpactedBatches(scenario) {
  return scenario.productionBatches
    .filter((batch) => parseBatchNumber(batch.id) <= parseBatchNumber(scenario.policy.mustSwitchBeforeBatch))
    .sort((left, right) => parseBatchNumber(left.id) - parseBatchNumber(right.id));
}

function generateCandidateCutoverPoints(scenario, impactedBatches) {
  const latestAllowedNumber = parseBatchNumber(scenario.policy.mustSwitchBeforeBatch);
  const candidates = [];
  const excluded = [];

  impactedBatches.forEach((batch, index) => {
    const batchNumber = parseBatchNumber(batch.id);
    const oldPartsNeededBeforeBatch = index * scenario.batchDemandQty;
    if (batchNumber >= latestAllowedNumber) {
      excluded.push({ batch: batch.id, reason: `生效策略要求必须在 ${scenario.policy.mustSwitchBeforeBatch} 前完成切换` });
      return;
    }
    if (oldPartsNeededBeforeBatch > scenario.supply.oldInventoryQty) {
      excluded.push({
        batch: batch.id,
        reason: `旧件库存仅够覆盖 ${Math.floor(scenario.supply.oldInventoryQty / scenario.batchDemandQty)} 批，无法延后到 ${batch.id} 才切换`,
      });
      return;
    }
    candidates.push(batch);
  });

  return { candidates, excluded };
}

function snapshotSupplyState(scenario) {
  return {
    oldInventoryQty: scenario.supply.oldInventoryQty,
    reallocatableOldQty: scenario.supply.reallocatableOldQty,
    nonRedeployableOldQty: scenario.supply.nonRedeployableOldQty,
    newPartEta: scenario.supply.newPartEta,
    newPartQty: scenario.supply.newPartQty,
    shipmentRef: scenario.supply.shipmentRef,
  };
}

function simulateCutoverCost(scenario, batch) {
  const newPartEta = toDate(scenario.supply.newPartEta);
  const batchNeedTime = toDate(batch.newPartRequiredAt);
  const waitHours = formatHours(Math.max(0, diffHours(newPartEta, batchNeedTime)));
  const waitCost = waitHours * scenario.costRules.downtimeCostPerHour;
  const scrapCost = scenario.supply.nonRedeployableOldQty * scenario.costRules.scrapCostPerOldPart;
  const reworkCost = batch.wip.unitsPastChangeStation * scenario.costRules.reworkCostPerVehicle;
  const expediteCost = waitHours > 0 ? scenario.costRules.expediteCostFlat : 0;
  const totalCost = sum([waitCost, scrapCost, reworkCost, expediteCost]);
  const riskFlags = [];
  const notes = [];

  if (waitHours > 0) {
    riskFlags.push("line_wait");
    notes.push(`新件 ETA 晚于 ${batch.id} 使用时间 ${waitHours} 小时，需要等待或重排。`);
  } else {
    notes.push(`新件在 ${batch.id} 开工前到货，无需等待。`);
  }

  if (reworkCost > 0) {
    riskFlags.push("rework");
    notes.push(`批次 ${batch.id} 已有 ${batch.wip.unitsPastChangeStation} 台车经过关键工位，需要返工。`);
  }

  if (scrapCost > 0) {
    notes.push(`预计有 ${scenario.supply.nonRedeployableOldQty} 件旧件尾料不可转移，需要报废。`);
  }

  if (expediteCost > 0) {
    notes.push("由于存在等待风险，默认计入一次加急物流成本。");
  }

  return {
    startBatch: batch.id,
    waitHours,
    waitCost,
    scrapCost,
    reworkCost,
    expediteCost,
    totalCost,
    riskFlags,
    notes,
  };
}

function rankCutoverOptions(costBreakdowns) {
  return [...costBreakdowns].sort((left, right) => {
    if (left.totalCost !== right.totalCost) {
      return left.totalCost - right.totalCost;
    }
    if (left.waitHours !== right.waitHours) {
      return left.waitHours - right.waitHours;
    }
    return parseBatchNumber(left.startBatch) - parseBatchNumber(right.startBatch);
  });
}

function buildCutoverCostReport(scenario, rankedOptions, evidenceBundle, assumptions) {
  const bestOption = rankedOptions[0];
  const summary = `在满足 ${scenario.policy.mustSwitchBeforeBatch} 前切换约束下，从 ${bestOption.startBatch} 开始切换总成本最低。`;

  return {
    id: `${scenario.engineeringChange.id}-CutoverCostReport`,
    title: `${scenario.engineeringChange.id} 切换成本报告`,
    changeId: scenario.engineeringChange.id,
    recommendedCutoverBatch: bestOption.startBatch,
    summary,
    options: rankedOptions,
    assumptions,
    evidenceBundle,
    reasoning: [
      `旧件库存可覆盖 ${Math.floor(scenario.supply.oldInventoryQty / scenario.batchDemandQty)} 个完整批次。`,
      `新件 ETA 为 ${scenario.supply.newPartEta}。`,
      `批次 ${bestOption.startBatch} 方案的总成本为 ${bestOption.totalCost.toLocaleString("zh-CN")} RMB。`,
    ],
  };
}

export function runAgentSimulation(question, scenarioId = "balanced-arrival") {
  const scenario = getScenarioById(scenarioId);
  const intentResult = groundBusinessIntent(question, scenario);

  if (intentResult.status !== "ok") {
    return {
      status: intentResult.status,
      scenario,
      userQuestion: question,
      message: intentResult.message,
    };
  }

  const intent = intentResult.businessIntent;
  const ontologyContext = resolveOntologyContext(intent, scenario);
  const evidenceBundle = [];
  const trace = [];

  evidenceBundle.push(
    buildEvidence(
      "ev-change",
      "设计变更",
      "ontology",
      `${scenario.engineeringChange.id} 将 ${scenario.engineeringChange.oldPartRevision} 替换为 ${scenario.engineeringChange.newPartRevision}，适用于 ${scenario.engineeringChange.appliesToModel}。`,
      ["EngineeringChange", "PartRevision", "ProductModel"],
    ),
  );
  evidenceBundle.push(
    buildEvidence(
      "ev-policy",
      "生效策略",
      "ontology",
      scenario.engineeringChange.effectivityRule,
      ["EngineeringChange"],
    ),
  );

  trace.push(
    createTraceStep(
      "t1",
      "语义解析",
      "llm_grounding",
      { question },
      {
        businessIntent: intent,
      },
      ["ev-change", "ev-policy"],
    ),
  );

  trace.push(
    createTraceStep(
      "t2",
      "本体对齐与能力发现",
      "ontology_resolution",
      { changeId: intent.changeId },
      {
        matchedObjectTypes: ontologyContext.matchedObjectTypes,
        matchedFunctions: ontologyContext.matchedFunctions.map((spec) => spec.id),
        matchedAction: ontologyContext.matchedActionSpec.id,
      },
      ["ev-change", "ev-policy"],
    ),
  );

  const affectedScope = resolveChangeScope(scenario);
  trace.push(
    createTraceStep(
      "t3",
      "解析变更影响范围",
      "function",
      { functionId: "resolve_change_scope", changeId: scenario.engineeringChange.id },
      affectedScope,
      ["ev-change"],
    ),
  );

  const impactedBatches = resolveImpactedBatches(scenario);
  evidenceBundle.push(
    buildEvidence(
      "ev-batches",
      "受影响批次",
      "runtime_data",
      `当前在制或排产且受变更影响的批次为 ${impactedBatches.map((batch) => batch.id).join("、")}。`,
      ["ProductionBatch", "WIPState"],
    ),
  );
  trace.push(
    createTraceStep(
      "t4",
      "定位受影响批次",
      "function",
      { functionId: "resolve_impacted_batches", model: scenario.productModel.id },
      { impactedBatches: impactedBatches.map((batch) => batch.id) },
      ["ev-batches"],
    ),
  );

  const candidateSet = generateCandidateCutoverPoints(scenario, impactedBatches);
  evidenceBundle.push(
    buildEvidence(
      "ev-candidates",
      "候选切换点",
      "derived_metric",
      `候选切换批次为 ${candidateSet.candidates.map((batch) => batch.id).join("、")}；排除项为 ${candidateSet.excluded.map((item) => `${item.batch}(${item.reason})`).join("；") || "无" }。`,
      ["ProductionBatch", "CostRule"],
    ),
  );
  trace.push(
    createTraceStep(
      "t5",
      "生成候选切换批次",
      "function",
      { functionId: "generate_candidate_cutover_points", impactedCount: impactedBatches.length },
      {
        candidates: candidateSet.candidates.map((batch) => batch.id),
        excluded: candidateSet.excluded,
      },
      ["ev-policy", "ev-candidates"],
    ),
  );

  const supplySnapshot = snapshotSupplyState(scenario);
  evidenceBundle.push(
    buildEvidence(
      "ev-supply",
      "供应快照",
      "runtime_data",
      `旧件库存 ${supplySnapshot.oldInventoryQty} 件，新件 ${scenario.engineeringChange.newPartRevision} 预计于 ${supplySnapshot.newPartEta} 到货。`,
      ["InventoryLot", "SupplyArrival"],
    ),
  );
  trace.push(
    createTraceStep(
      "t6",
      "读取供应状态快照",
      "function",
      { functionId: "snapshot_supply_state", changeId: scenario.engineeringChange.id },
      supplySnapshot,
      ["ev-supply"],
    ),
  );

  const costBreakdowns = candidateSet.candidates.map((batch) => simulateCutoverCost(scenario, batch));
  costBreakdowns.forEach((breakdown) => {
    evidenceBundle.push(
      buildEvidence(
        `ev-${breakdown.startBatch.toLowerCase()}`,
        `${breakdown.startBatch} 成本拆分`,
        "derived_metric",
        `${breakdown.startBatch} 的总成本为 ${breakdown.totalCost.toLocaleString("zh-CN")} RMB，其中等待 ${breakdown.waitHours} 小时。`,
        ["CostRule", "ProductionBatch", "SupplyArrival"],
      ),
    );
    trace.push(
      createTraceStep(
        `sim-${breakdown.startBatch}`,
        `仿真 ${breakdown.startBatch} 切换成本`,
        "function",
        { functionId: "simulate_cutover_cost", startBatch: breakdown.startBatch },
        breakdown,
        [`ev-${breakdown.startBatch.toLowerCase()}`],
      ),
    );
  });

  const rankedOptions = rankCutoverOptions(costBreakdowns).map((option, index) => ({
    ...option,
    rank: index + 1,
  }));
  trace.push(
    createTraceStep(
      "t7",
      "排序候选方案",
      "function",
      { functionId: "rank_cutover_options", optionCount: rankedOptions.length },
      { rankedOptions: rankedOptions.map((option) => ({ batch: option.startBatch, totalCost: option.totalCost, rank: option.rank })) },
      costBreakdowns.map((breakdown) => `ev-${breakdown.startBatch.toLowerCase()}`),
    ),
  );

  const allAssumptions = [...scenario.assumptions, ...intent.assumptions];
  const report = buildCutoverCostReport(scenario, rankedOptions, evidenceBundle, allAssumptions);
  trace.push(
    createTraceStep(
      "t8",
      "生成最终报告",
      "action",
      { actionId: "create_cutover_cost_analysis" },
      {
        reportId: report.id,
        recommendedCutoverBatch: report.recommendedCutoverBatch,
        summary: report.summary,
      },
      ["ev-change", "ev-policy", "ev-supply", ...rankedOptions.map((option) => `ev-${option.startBatch.toLowerCase()}`)],
    ),
  );

  const answer = [
    `已完成 ${scenario.engineeringChange.id} 的切换成本分析。`,
    `受影响批次：${impactedBatches.map((batch) => batch.id).join("、")}。`,
    candidateSet.excluded.length > 0
      ? `由于策略约束，排除：${candidateSet.excluded.map((item) => `${item.batch}（${item.reason}）`).join("；")}。`
      : "没有批次因策略约束被排除。",
    `推荐切换批次：${report.recommendedCutoverBatch}。`,
    "成本对比：",
    ...report.options.map(
      (option) =>
        `- 从 ${option.startBatch} 开始切换：${option.totalCost.toLocaleString("zh-CN")} RMB（等待 ${option.waitHours}h，报废 ${option.scrapCost.toLocaleString("zh-CN")} RMB，加急 ${option.expediteCost.toLocaleString("zh-CN")} RMB）`,
    ),
    "推荐原因：",
    ...report.reasoning.map((line) => `- ${line}`),
  ].join("\n");

  return {
    status: "ok",
    scenario,
    userQuestion: question,
    businessIntent: intent,
    ontologyContext,
    evidenceBundle,
    trace,
    report,
    answer,
  };
}

export function getDemoManifest() {
  return {
    ontologySchema,
    functionSpecs,
    actionSpecs,
  };
}
