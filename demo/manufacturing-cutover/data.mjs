export const ontologySchema = {
  objectTypes: [
    {
      id: "EngineeringChange",
      name: "设计变更",
      description: "表达一次设计变更事件及其生效约束。",
      fields: ["id", "title", "oldPartRevision", "newPartRevision", "appliesToModel", "effectivityRule", "compatibilityRule"],
    },
    {
      id: "PartRevision",
      name: "零件版本",
      description: "表达具体零件的修订版本。",
      fields: ["id", "partId", "revision", "description"],
    },
    {
      id: "ProductModel",
      name: "产品型号",
      description: "表达受影响的整车型号或产品型号。",
      fields: ["id", "name", "plant"],
    },
    {
      id: "BOMNode",
      name: "BOM 节点",
      description: "表达零件在产品结构中的使用位置。",
      fields: ["id", "assembly", "position", "usedPartRevision"],
    },
    {
      id: "ProductionBatch",
      name: "生产批次",
      description: "表达在产或排产批次。",
      fields: ["id", "model", "quantity", "currentStation", "changeRelatedStation", "newPartRequiredAt"],
    },
    {
      id: "WIPState",
      name: "在制状态",
      description: "表达某一批次当前的工序状态和返工风险。",
      fields: ["label", "unitsPastChangeStation", "isStarted"],
    },
    {
      id: "InventoryLot",
      name: "旧件库存",
      description: "表达可用旧件库存及其处置说明。",
      fields: ["partRevision", "availableQty", "reallocatableQty", "nonRedeployableQty"],
    },
    {
      id: "SupplyArrival",
      name: "新件到货",
      description: "表达新件供应到货时间和数量。",
      fields: ["partRevision", "eta", "availableQty", "shipmentRef"],
    },
    {
      id: "CostRule",
      name: "成本规则",
      description: "表达等待、返工、报废、加急等成本计算规则。",
      fields: ["downtimeCostPerHour", "scrapCostPerOldPart", "reworkCostPerVehicle", "expediteCostFlat"],
    },
    {
      id: "FunctionSpec",
      name: "函数能力",
      description: "表达分析、查询、仿真、排序等只读或近似只读的业务能力。",
      fields: ["id", "functionType", "readsTypes", "produces", "summary"],
    },
    {
      id: "ActionSpec",
      name: "动作能力",
      description: "表达对一条完整业务处理链路的编排入口。",
      fields: ["id", "actionType", "callsFunctions", "produces", "sideEffects"],
    },
    {
      id: "ReportArtifact",
      name: "报告产物",
      description: "表达最终产出的分析报告。",
      fields: ["id", "title", "summary", "recommendedCutoverBatch"],
    },
  ],
  relationTypes: [
    { id: "REPLACES", from: "EngineeringChange", to: "PartRevision", description: "指定被替换旧件" },
    { id: "INTRODUCES", from: "EngineeringChange", to: "PartRevision", description: "指定引入新件" },
    { id: "APPLIES_TO_MODEL", from: "EngineeringChange", to: "ProductModel", description: "指定受影响型号" },
    { id: "USED_IN", from: "PartRevision", to: "BOMNode", description: "指定零件使用位置" },
    { id: "BELONGS_TO", from: "BOMNode", to: "ProductModel", description: "指定 BOM 节点所属型号" },
    { id: "CONSUMES", from: "ProductionBatch", to: "PartRevision", description: "指定批次当前消耗的零件版本" },
    { id: "HAS_WIP_STATE", from: "ProductionBatch", to: "WIPState", description: "指定批次当前在制状态" },
    { id: "INBOUND_FOR", from: "SupplyArrival", to: "PartRevision", description: "指定新件到货信息" },
    { id: "GOVERNS_SWITCH", from: "CostRule", to: "EngineeringChange", description: "指定成本与切换规则" },
    { id: "READS_TYPE", from: "FunctionSpec", to: "ObjectType", description: "指定函数读取的类型" },
    { id: "PRODUCES", from: "FunctionSpec", to: "ReportArtifact", description: "指定函数产物" },
    { id: "CALLS", from: "ActionSpec", to: "FunctionSpec", description: "指定动作调用的函数" },
  ],
  reportArtifacts: [
    {
      id: "CutoverCostReport",
      name: "切换成本报告",
      description: "按候选切换批次汇总时间成本、金钱成本、风险标记与推荐结果。",
    },
  ],
};

export const functionSpecs = [
  {
    id: "resolve_change_scope",
    name: "解析变更影响范围",
    functionType: "query",
    readsTypes: ["EngineeringChange", "PartRevision", "ProductModel", "BOMNode"],
    produces: ["AffectedScope"],
    summary: "根据设计变更确定受影响型号、BOM 节点和零件替换边界。",
  },
  {
    id: "resolve_impacted_batches",
    name: "定位受影响批次",
    functionType: "query",
    readsTypes: ["EngineeringChange", "ProductionBatch", "ProductModel"],
    produces: ["ImpactedBatchSet"],
    summary: "找出当前在产或排产且受该变更影响的批次集合。",
  },
  {
    id: "generate_candidate_cutover_points",
    name: "生成候选切换批次",
    functionType: "rule",
    readsTypes: ["ProductionBatch", "InventoryLot", "EngineeringChange", "CostRule"],
    produces: ["CandidateCutoverSet"],
    summary: "根据生效策略、旧件覆盖能力和批次状态生成候选切换点。",
  },
  {
    id: "snapshot_supply_state",
    name: "读取供应状态快照",
    functionType: "query",
    readsTypes: ["InventoryLot", "SupplyArrival", "EngineeringChange"],
    produces: ["SupplySnapshot"],
    summary: "读取旧件库存、新件 ETA 以及尾料处置边界。",
  },
  {
    id: "simulate_cutover_cost",
    name: "仿真单批次切换成本",
    functionType: "simulation",
    readsTypes: ["EngineeringChange", "ProductionBatch", "InventoryLot", "SupplyArrival", "CostRule"],
    produces: ["CostBreakdown"],
    summary: "计算某个候选切换批次的等待、报废、返工、加急和总成本。",
  },
  {
    id: "rank_cutover_options",
    name: "排序候选切换方案",
    functionType: "ranking",
    readsTypes: ["CostBreakdown"],
    produces: ["RankedCutoverOptions"],
    summary: "按总成本、等待风险和批次顺序对候选方案排序。",
  },
  {
    id: "build_cutover_cost_report",
    name: "生成切换成本报告",
    functionType: "transform",
    readsTypes: ["RankedCutoverOptions", "EngineeringChange"],
    produces: ["CutoverCostReport"],
    summary: "将排序结果、证据链和关键假设整合为最终报告。",
  },
];

export const actionSpecs = [
  {
    id: "create_cutover_cost_analysis",
    name: "生成设计切换成本分析",
    actionType: "analysis",
    appliesTo: ["EngineeringChange"],
    callsFunctions: [
      "resolve_change_scope",
      "resolve_impacted_batches",
      "generate_candidate_cutover_points",
      "snapshot_supply_state",
      "simulate_cutover_cost",
      "rank_cutover_options",
      "build_cutover_cost_report",
    ],
    produces: ["CutoverCostReport"],
    sideEffects: [],
    summary: "围绕设计变更自动完成批次切换成本分析并生成报告。",
  },
];

export const scenarios = [
  {
    id: "balanced-arrival",
    name: "案例 A：新件按时到货，B104 最优",
    overview: "旧件可覆盖前两批，新件在 B104 开工前到货，适合展示等待成本与尾料报废的平衡。",
    defaultQuestion: "ECN-204：零件 P123-RevA 替换为 P456-RevB，请输出从各个批次开始切换的成本报告，并推荐最佳切换批次。",
    assumptions: [
      "每批次需求 60 件变更零件。",
      "旧件中的大部分可转做售后或其他线体，仅 20 件尾料不可转移。",
      "B102 尚未到 S30 安装工位，因此切换不会触发返工。",
    ],
    engineeringChange: {
      id: "ECN-204",
      title: "制动支架零件替换",
      oldPartRevision: "P123-RevA",
      newPartRevision: "P456-RevB",
      appliesToModel: "Model-X",
      effectivityRule: "必须在批次 B105 之前完成切换",
      compatibilityRule: "旧件与新件不可混装于同一单车",
    },
    productModel: { id: "Model-X", name: "Model-X", plant: "Factory-7" },
    bomNode: { id: "BOM-Bracket-FrontBrake", assembly: "FrontBrake", position: "Bracket", usedPartRevision: "P123-RevA" },
    batchDemandQty: 60,
    productionBatches: [
      { id: "B102", quantity: 60, currentStation: "S20", changeRelatedStation: "S30", newPartRequiredAt: "2026-03-17T14:00:00+08:00", wip: { label: "已上线，尚未安装变更零件", unitsPastChangeStation: 0, isStarted: true } },
      { id: "B103", quantity: 60, currentStation: "S10", changeRelatedStation: "S30", newPartRequiredAt: "2026-03-18T02:00:00+08:00", wip: { label: "已排产，未到关键工位", unitsPastChangeStation: 0, isStarted: true } },
      { id: "B104", quantity: 60, currentStation: "NotStarted", changeRelatedStation: "S30", newPartRequiredAt: "2026-03-18T14:00:00+08:00", wip: { label: "次日计划开工", unitsPastChangeStation: 0, isStarted: false } },
      { id: "B105", quantity: 60, currentStation: "NotStarted", changeRelatedStation: "S30", newPartRequiredAt: "2026-03-19T08:00:00+08:00", wip: { label: "不允许继续使用旧件", unitsPastChangeStation: 0, isStarted: false } },
    ],
    supply: {
      oldInventoryQty: 140,
      reallocatableOldQty: 120,
      nonRedeployableOldQty: 20,
      newPartEta: "2026-03-18T08:00:00+08:00",
      newPartQty: 240,
      shipmentRef: "ASN-9001",
    },
    costRules: {
      downtimeCostPerHour: 30000,
      scrapCostPerOldPart: 200,
      reworkCostPerVehicle: 800,
      expediteCostFlat: 8000,
      objective: "total_cost_min",
    },
    policy: {
      mustSwitchBeforeBatch: "B105",
      unsupportedIntentKeywords: ["写回", "锁批次", "执行变更"],
    },
  },
  {
    id: "inventory-tight",
    name: "案例 B：旧件不足，B203 最优",
    overview: "旧件只够覆盖一批，新件在第二批开工前到货，适合展示库存覆盖约束如何过滤候选切换点。",
    defaultQuestion: "ECN-318：将零件 P220-RevC 切换为 P221-RevA，请给出各批次切换成本对比。",
    assumptions: [
      "旧件可覆盖一批整车，但不足以覆盖第二批。",
      "仅 10 件旧件尾料不可转移，需要报废。",
    ],
    engineeringChange: {
      id: "ECN-318",
      title: "转向支撑件改版",
      oldPartRevision: "P220-RevC",
      newPartRevision: "P221-RevA",
      appliesToModel: "Model-Y",
      effectivityRule: "必须在批次 B205 之前完成切换",
      compatibilityRule: "旧件与新件不可混装于同一单车",
    },
    productModel: { id: "Model-Y", name: "Model-Y", plant: "Factory-3" },
    bomNode: { id: "BOM-Steering-Brace", assembly: "Steering", position: "Brace", usedPartRevision: "P220-RevC" },
    batchDemandQty: 60,
    productionBatches: [
      { id: "B202", quantity: 60, currentStation: "S20", changeRelatedStation: "S30", newPartRequiredAt: "2026-03-17T16:00:00+08:00", wip: { label: "已上线，待关键工位", unitsPastChangeStation: 0, isStarted: true } },
      { id: "B203", quantity: 60, currentStation: "S15", changeRelatedStation: "S30", newPartRequiredAt: "2026-03-18T12:00:00+08:00", wip: { label: "已排产，关键工位前", unitsPastChangeStation: 0, isStarted: true } },
      { id: "B204", quantity: 60, currentStation: "NotStarted", changeRelatedStation: "S30", newPartRequiredAt: "2026-03-18T20:00:00+08:00", wip: { label: "待开工", unitsPastChangeStation: 0, isStarted: false } },
      { id: "B205", quantity: 60, currentStation: "NotStarted", changeRelatedStation: "S30", newPartRequiredAt: "2026-03-19T10:00:00+08:00", wip: { label: "策略禁止后延", unitsPastChangeStation: 0, isStarted: false } },
    ],
    supply: {
      oldInventoryQty: 70,
      reallocatableOldQty: 60,
      nonRedeployableOldQty: 10,
      newPartEta: "2026-03-18T09:00:00+08:00",
      newPartQty: 180,
      shipmentRef: "ASN-9110",
    },
    costRules: {
      downtimeCostPerHour: 30000,
      scrapCostPerOldPart: 200,
      reworkCostPerVehicle: 800,
      expediteCostFlat: 8000,
      objective: "total_cost_min",
    },
    policy: {
      mustSwitchBeforeBatch: "B205",
      unsupportedIntentKeywords: ["写回", "锁批次", "执行变更"],
    },
  },
  {
    id: "policy-tight",
    name: "案例 C：策略窗口紧，B302 最优",
    overview: "策略要求最晚在 B303 前完成切换，适合展示 effectivity rule 如何约束候选批次。",
    defaultQuestion: "ECN-402：零件 P510-RevB 替换为 P511-RevA，请输出切换成本报告。",
    assumptions: [
      "旧件可覆盖一批，第二批开始必须切换。",
      "仅 20 件尾料不可转移，需要报废。",
    ],
    engineeringChange: {
      id: "ECN-402",
      title: "后悬支撑件替换",
      oldPartRevision: "P510-RevB",
      newPartRevision: "P511-RevA",
      appliesToModel: "Model-Z",
      effectivityRule: "必须在批次 B303 之前完成切换",
      compatibilityRule: "同一批次内不可混装旧件与新件",
    },
    productModel: { id: "Model-Z", name: "Model-Z", plant: "Factory-5" },
    bomNode: { id: "BOM-Rear-Support", assembly: "RearSuspension", position: "Support", usedPartRevision: "P510-RevB" },
    batchDemandQty: 60,
    productionBatches: [
      { id: "B301", quantity: 60, currentStation: "S20", changeRelatedStation: "S30", newPartRequiredAt: "2026-03-17T21:00:00+08:00", wip: { label: "已上线，待安装", unitsPastChangeStation: 0, isStarted: true } },
      { id: "B302", quantity: 60, currentStation: "S12", changeRelatedStation: "S30", newPartRequiredAt: "2026-03-18T10:00:00+08:00", wip: { label: "已排产，待装配", unitsPastChangeStation: 0, isStarted: true } },
      { id: "B303", quantity: 60, currentStation: "NotStarted", changeRelatedStation: "S30", newPartRequiredAt: "2026-03-18T18:00:00+08:00", wip: { label: "超出策略窗口", unitsPastChangeStation: 0, isStarted: false } },
    ],
    supply: {
      oldInventoryQty: 80,
      reallocatableOldQty: 60,
      nonRedeployableOldQty: 20,
      newPartEta: "2026-03-18T08:00:00+08:00",
      newPartQty: 120,
      shipmentRef: "ASN-9220",
    },
    costRules: {
      downtimeCostPerHour: 30000,
      scrapCostPerOldPart: 200,
      reworkCostPerVehicle: 800,
      expediteCostFlat: 8000,
      objective: "total_cost_min",
    },
    policy: {
      mustSwitchBeforeBatch: "B303",
      unsupportedIntentKeywords: ["写回", "锁批次", "执行变更"],
    },
  },
];

export function getScenarioById(id) {
  return scenarios.find((scenario) => scenario.id === id) ?? scenarios[0];
}

export function getFunctionSpec(id) {
  return functionSpecs.find((spec) => spec.id === id);
}

export function getActionSpec(id) {
  return actionSpecs.find((spec) => spec.id === id);
}
