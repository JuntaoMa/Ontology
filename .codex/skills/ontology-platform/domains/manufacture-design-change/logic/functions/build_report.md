# Function Logic

metadata_id:
- `build_report`

输入:
- `DesignChangeOrder.id`
- `ProductionBatch.id`
- `switch_scope.lineCode`
- `switch_scope.switchPointAt`
- `impacted_mpart_ready_cycles`
- `assumptions`
- `evidence_bindings`

输出:
- `change_material_readiness_report`

前置约束:
- `impacted_mpart_ready_cycles` 已包含每个受影响新物料的准备周期结果

逻辑体:
1. 设 `overall_ready_cycle` = `max(impacted_mpart_ready_cycles[].readyCycleHours)`
2. 设 `blocking_parts` = 从 `impacted_mpart_ready_cycles` 中选取 `readyCycleHours = overall_ready_cycle` 的零件
3. 设 `change_material_readiness_report.changeId = DesignChangeOrder.id`
4. 设 `change_material_readiness_report.batchId = ProductionBatch.id`
5. 设 `change_material_readiness_report.switchPointAt = switch_scope.switchPointAt`
6. 设 `change_material_readiness_report.lineCode = switch_scope.lineCode`
7. 设 `change_material_readiness_report.overallReadyCycleHours = overall_ready_cycle`
8. 设 `change_material_readiness_report.blockingParts = blocking_parts`
9. 设 `change_material_readiness_report.partCycles = impacted_mpart_ready_cycles`
10. 设 `change_material_readiness_report.assumptions = assumptions`
11. 设 `change_material_readiness_report.evidenceBindings = evidence_bindings`
12. 返回 `change_material_readiness_report`

失败条件:
- `impacted_mpart_ready_cycles` 为空
