import type { DemoCase } from "../utils/types";

export const DEMO_CASES: DemoCase[] = [
  {
    id: "material-ready",
    domainId: "manufacture-design-change",
    title: "第三批次切换物料可用周期",
    question: "当前设计变更单，如果从第三批次开始切换变更，涉及的新物料可用周期是多久？",
    hints: ["可用周期", "第三批次", "新物料", "切换变更"],
    problemClass: "已知业务流程类问题",
    capabilityAssessment: "现有能力足以直接处理，命中 Action create_report(...) 与配套 Function 链路。",
    conclusions: [
      "当前设计变更单 DCO-2026-017 可以从第三批次 PB-003 开始切换。",
      "涉及的新物料整体可用周期为 100 小时。",
      "整体准备完成时间为 2026-03-20 13:00:00 +08:00，早于第三批次切换时间 2026-03-20 16:00:00 +08:00。",
      "最终瓶颈是上层装配件“控制模块 A2”，其准备周期为 100 小时。",
      "如果只看底层新件，主要瓶颈是采购件“温度传感器 S2”，准备周期为 84 小时。"
    ],
    matched: {
      objects: ["DesignChangeOrder", "ChangeImpactItem", "ProductionBatch", "ProductionLineState", "MBOMNode", "MPart"],
      links: ["HAS_IMPACT_ITEM", "AFFECTS_EBOM_NODE", "FOR_MODEL", "INTRODUCES_NEW_EPART_VERSION", "MAPPED_TO_MBOM_NODE", "USES_MPART", "CHILD_OF_MBOM", "FOR_MPART", "ORDERS_MPART", "QUALIFIES_MPART"],
      functions: ["build_scope", "check_inventory", "calc_leaf_ready", "calc_assembly_ready", "calc_ready", "build_report"],
      actions: ["create_report"]
    },
    steps: [
      { tool: "discover_domains()", purpose: "确定问题所属业务域。", result: "命中 manufacture-design-change。" },
      { tool: "get_action_detail('manufacture-design-change', 'create_report')", purpose: "确认现有能力是否覆盖问题。", result: "现有 action 和函数链足以处理该问题。" },
      { tool: "query_instances_by_type(...)", purpose: "读取设计变更单与生产批次锚点对象。", result: "定位到 DCO-2026-017 和第三批次 PB-003。" },
      { tool: "query_instances_by_path(..., 'change-to-relevant-impact-items-for-batch', ...)", purpose: "确认第三批次处于本次设计变更影响范围内。", result: "命中受影响对象，确认 PB-003 属于切换范围。" },
      { tool: "query_instances_by_path(..., 'impact-item-to-new-mparts', ...)", purpose: "找到切换后的新制造件。", result: "定位到新装配件“控制模块 A2”。" },
      { tool: "query_instances_by_path(..., 'batch-to-line-state', ...)", purpose: "读取第三批次对应的生产线状态。", result: "识别切换时间和产线状态，用于后续切换范围归一化。" },
      { tool: "build_scope(...)", purpose: "归一化设计变更、目标批次、切换时间和新物料目标。", result: "形成统一切换范围：批量 120，切换点 2026-03-20 16:00:00 +08:00。" },
      { tool: "query_instances_by_path(..., 'mpart-to-mbom-subtree', ...)", purpose: "展开新制造件的 MBOM 子树。", result: "展开出控制模块 A2、温度传感器 S2、固定支架 B2、密封圈 55C。" },
      { tool: "query_instances_by_path(..., 'mpart-to-inventory', ...)", purpose: "读取新物料库存位置和库存批次。", result: "识别温度传感器和固定支架库存不足，密封圈库存充足。" },
      { tool: "query_instances_by_path(..., 'mpart-to-purchase-and-certification', ...)", purpose: "读取采购件的在途订单和采购认证。", result: "识别温度传感器存在在途订单，但采购认证尚未完成。" },
      { tool: "calc_ready(...)", purpose: "按 MBOM 自底向上计算每层零件准备周期。", result: "温度传感器 S2 为 84 小时，固定支架 B2 为 36 小时，密封圈 55C 为 0 小时，控制模块 A2 为 100 小时。" },
      { tool: "build_report(...)", purpose: "生成业务报告。", result: "输出“第三批次可切换，整体物料可用周期 100 小时，最终瓶颈为控制模块 A2”的结论。" }
    ],
    summary: {
      domain: "manufacture-design-change",
      anchors: ["设计变更单 DCO-2026-017", "生产批次 PB-003"],
      resultHeadline: "整体物料可用周期 100 小时，第三批次可切换。"
    }
  },
  {
    id: "scrap-cost",
    domainId: "manufacture-design-change",
    title: "第三批次切换旧物料报废成本",
    question: "从第三批次开始切换设计变更，现有设计变更单涉及的需报废旧物料的报废成本是多少？",
    hints: ["报废成本", "旧物料", "报废", "第三批次"],
    problemClass: "能力缺口业务流程类问题",
    capabilityAssessment: "现有数据模型、路径模板和查询能力已足够定位事实，但还缺一个正式的报废成本计算 Function。",
    conclusions: [
      "当前设计变更单 DCO-2026-017 从第三批次 PB-003 开始切换时，命中的旧件处置意见为“报废”。",
      "需报废的旧制造件为“控制模块 A1”。",
      "旧件库存批次可用量为 24，库存批次账面单价为 760 RMB。",
      "本次旧物料报废成本为 18240 RMB。"
    ],
    matched: {
      objects: ["DesignChangeOrder", "ChangeImpactItem", "ProductionBatch", "EPartVersion", "MPart", "InventoryPosition", "InventoryLot"],
      links: ["HAS_IMPACT_ITEM", "REPLACES_OLD_EPART_VERSION", "REALIZED_AS_MPART", "FOR_MPART", "FOR_MPART_LOT", "LOCATED_IN"],
      functions: [],
      actions: []
    },
    steps: [
      { tool: "discover_domains()", purpose: "确定问题所属业务域。", result: "命中 manufacture-design-change。" },
      { tool: "assess_problem_capability_fit('manufacture-design-change', problem_statement)", purpose: "确认现有能力覆盖情况。", result: "查询能力足够，但缺少正式的报废成本计算 Function。" },
      { tool: "query_instances_by_type(...)", purpose: "读取设计变更单与目标批次。", result: "定位到 DCO-2026-017 与 PB-003。" },
      { tool: "query_instances_by_path(..., 'change-to-relevant-impact-items-for-batch', ...)", purpose: "确认第三批次位于设计变更影响范围内。", result: "命中受影响对象，确认 PB-003 需要处理该设计变更。" },
      { tool: "query_instances_by_path(..., 'impact-item-to-old-part-disposition', ...)", purpose: "读取旧件处置意见。", result: "处置意见为“报废”。" },
      { tool: "query_instances_by_path(..., 'impact-item-to-old-mparts', ...)", purpose: "定位需报废的旧制造件。", result: "定位到旧制造件“控制模块 A1”。" },
      { tool: "query_instances_by_path(..., 'mpart-to-inventory', ...)", purpose: "读取旧件库存批次和成本依据。", result: "读取到旧件库存批次可用量 24、账面单价 760 RMB。" },
      { tool: "draft_new_capability('manufacture-design-change', problem_statement)", purpose: "生成缺失能力草案。", result: "生成 Function 草案 calc_scrap_cost(...)." },
      { tool: "calc_scrap_cost(...)", purpose: "根据处置意见、库存数量和成本口径计算报废成本。", result: "报废成本 18240 RMB。" }
    ],
    summary: {
      domain: "manufacture-design-change",
      anchors: ["设计变更单 DCO-2026-017", "生产批次 PB-003", "旧制造件 控制模块 A1"],
      resultHeadline: "旧物料报废成本为 18240 RMB。"
    },
    proposedCapabilities: [
      {
        type: "Function",
        id: "calc_scrap_cost",
        name: "计算报废成本",
        summary: "当旧件处置意见为报废时，依据库存数量与成本口径计算需报废旧物料的成本。",
        logic: [
          "如果 ChangeImpactItem.oldPartDisposition 不是 \"scrap\"，则返回 0。",
          "如果存在 InventoryLot.availableQty 和 InventoryLot.bookUnitCost，则按库存批次可用量 × 库存批次账面单价求和。",
          "否则，如果存在 InventoryPosition.onHandQty 和 MPart.standardUnitCost，则按在手量 × 标准单价计算。",
          "如果库存或成本事实缺失，则返回失败并提示补充字段。"
        ]
      }
    ]
  }
];

export function matchDemoCase(question: string): DemoCase | null {
  const normalized = question.trim().toLowerCase();
  const scored = DEMO_CASES.map((item) => ({
    item,
    score: item.hints.filter((hint) => normalized.includes(hint.toLowerCase())).length,
  }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.item || null;
}
