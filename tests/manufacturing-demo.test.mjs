import assert from "node:assert/strict";
import { runAgentSimulation } from "../demo/manufacturing-cutover/engine.mjs";

function assertOptionOrder(result, expectedBatches) {
  assert.deepEqual(
    result.report.options.map((option) => option.startBatch),
    expectedBatches,
  );
}

const defaultResult = runAgentSimulation(
  "ECN-204：零件 P123-RevA 替换为 P456-RevB，请输出从各个批次开始切换的成本报告，并推荐最佳切换批次。",
  "balanced-arrival",
);
assert.equal(defaultResult.status, "ok");
assert.equal(defaultResult.report.recommendedCutoverBatch, "B104");
assertOptionOrder(defaultResult, ["B104", "B103", "B102"]);
assert.equal(defaultResult.report.options[0].totalCost, 4000);

const inventoryTightResult = runAgentSimulation(
  "ECN-318：将零件 P220-RevC 切换为 P221-RevA，请给出各批次切换成本对比。",
  "inventory-tight",
);
assert.equal(inventoryTightResult.status, "ok");
assert.equal(inventoryTightResult.report.recommendedCutoverBatch, "B203");
assertOptionOrder(inventoryTightResult, ["B203", "B202"]);

const policyTightResult = runAgentSimulation(
  "ECN-402：零件 P510-RevB 替换为 P511-RevA，请输出切换成本报告。",
  "policy-tight",
);
assert.equal(policyTightResult.status, "ok");
assert.equal(policyTightResult.report.recommendedCutoverBatch, "B302");
assertOptionOrder(policyTightResult, ["B302", "B301"]);

const unsupportedResult = runAgentSimulation(
  "ECN-204：请直接锁批次并写回 MES。",
  "balanced-arrival",
);
assert.equal(unsupportedResult.status, "unsupported");

const unknownChangeResult = runAgentSimulation(
  "ECN-999：请输出切换成本报告。",
  "balanced-arrival",
);
assert.equal(unknownChangeResult.status, "needs_clarification");

console.log("manufacturing-demo.test.mjs: all checks passed");
