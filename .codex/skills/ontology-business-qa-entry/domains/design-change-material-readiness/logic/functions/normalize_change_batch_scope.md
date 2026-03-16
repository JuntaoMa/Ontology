# Function Logic

metadata_id:
- `normalize_change_batch_scope`

输入:
- `DesignChangeOrder.id`
- `relevant_change_impact_items`
- `impacted_material_bindings`
- `ProductionBatch.id`
- `ProductionBatch.plannedQty`
- `ProductionBatch.plannedStartAt`
- `ProductionBatch.switchDecisionAt`
- `ProductionLineState.lineCode`

输出:
- `switch_scope`

前置约束:
- `DesignChangeOrder.id` 已绑定
- `ProductionBatch.id` 已绑定
- `relevant_change_impact_items` 已按目标批次所属 `ProductModel` 过滤

逻辑体:
1. 设 `switch_point_at` = `ProductionBatch.switchDecisionAt`
2. 如果 `switch_point_at` 不存在
   则
   - 设 `switch_point_at` = `ProductionBatch.plannedStartAt`
3. 设 `target_batch_qty` = `ProductionBatch.plannedQty`
4. 设 `new_material_targets` = 从 `impacted_material_bindings` 中提取每个 `MPart.id`、`MBOMNode.quantityPerParent` 和对应 `ChangeImpactItem.id`
5. 设 `switch_scope.changeId` = `DesignChangeOrder.id`
6. 设 `switch_scope.batchId` = `ProductionBatch.id`
7. 设 `switch_scope.lineCode` = `ProductionLineState.lineCode`
8. 设 `switch_scope.switchPointAt` = `switch_point_at`
9. 设 `switch_scope.batchQty` = `target_batch_qty`
10. 设 `switch_scope.impactedItems` = `relevant_change_impact_items`
11. 设 `switch_scope.newMaterialTargets` = `new_material_targets`
12. 返回 `switch_scope`

失败条件:
- `ProductionBatch.plannedQty` 缺失
- `impacted_material_bindings` 为空
