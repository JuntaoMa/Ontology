# Action Logic

metadata_id:
- `create_change_switch_material_readiness_report`

输入:
- `DesignChangeOrder.id`
- `ProductionBatch.id`
- `Context.now`

输出:
- `ChangeMaterialReadinessReport`

调用能力:
- `query_instances_by_type(domain_id, node_type, filters)`
- `query_instances_by_path(domain_id, anchor_binding, path_template_id, filters)`
- `normalize_change_batch_scope(...)`
- `calculate_impacted_mpart_ready_cycles(...)`
- `build_change_material_readiness_report(...)`

逻辑体:
1. 查询 `query_instances_by_type("design-change-material-readiness", "DesignChangeOrder", { "DesignChangeOrder.id": DesignChangeOrder.id })` 作为 `change_order`
2. 断言 `change_order` 存在
3. 查询 `query_instances_by_type("design-change-material-readiness", "ProductionBatch", { "ProductionBatch.id": ProductionBatch.id })` 作为 `target_batch`
4. 断言 `target_batch` 存在
5. 查询 `query_instances_by_path("design-change-material-readiness", change_order, "change-to-relevant-impact-items-for-batch", { "ProductionBatch.id": ProductionBatch.id })` 作为 `relevant_impact_bindings`
6. 如果 `relevant_impact_bindings` 为空
   则
   - 失败 `"change_not_applicable_to_target_batch"`
7. 设 `relevant_change_impact_items` = 从 `relevant_impact_bindings` 中提取每个 `ChangeImpactItem`
8. 查询 `query_instances_by_path("design-change-material-readiness", relevant_change_impact_items, "impact-item-to-new-mparts", {})` 作为 `impacted_material_bindings`
9. 查询 `query_instances_by_path("design-change-material-readiness", target_batch, "batch-to-line-state", {})` 作为 `line_state`
10. 断言 `impacted_material_bindings` 非空
11. 断言 `line_state` 存在
12. 调用 `normalize_change_batch_scope(change_order, relevant_change_impact_items, impacted_material_bindings, target_batch, line_state)` 作为 `switch_scope`
13. 设 `expanded_mpart_tree = []`
14. 对 `switch_scope.newMaterialTargets` 中的每个 `target` 执行
    - 查询 `query_instances_by_path("design-change-material-readiness", target, "mpart-to-mbom-subtree", {})` 作为 `subtree`
    - 将 `subtree` 追加到 `expanded_mpart_tree`
15. 如果 `expanded_mpart_tree` 为空
    则
    - 失败 `"empty_mbom_subtree"`
16. 设 `expanded_mpart_tree` = 按 `MBOMNode.id` 去重后的结果
17. 查询 `query_instances_by_path("design-change-material-readiness", expanded_mpart_tree, "mpart-to-inventory", {})` 作为 `inventory_bindings`
18. 查询 `query_instances_by_path("design-change-material-readiness", expanded_mpart_tree, "mpart-to-purchase-and-certification", {})` 作为 `supply_bindings`
19. 设 `purchase_order_bindings` = 从 `supply_bindings` 中提取每个 `PurchaseOrder`
20. 设 `certification_bindings` = 从 `supply_bindings` 中提取每个 `ProcurementCertification`
21. 设 `assumptions` = [
    "采购认证周期与采购周期按顺序累加",
    "库存覆盖优先采用库存批次可用量，缺失时回退到库存位置聚合量",
    "装配件准备周期按 max(下层零件准备周期) + 装配周期 计算"
    ]
22. 调用 `calculate_impacted_mpart_ready_cycles(switch_scope, expanded_mpart_tree, inventory_bindings, purchase_order_bindings, certification_bindings, Context.now)` 作为 `ready_cycles`
23. 调用 `build_change_material_readiness_report(change_order, target_batch, switch_scope, ready_cycles, assumptions, [relevant_change_impact_items, impacted_material_bindings, expanded_mpart_tree, inventory_bindings, supply_bindings])` 作为 `report`
24. 返回 `report`

失败条件:
- `DesignChangeOrder.id` 不存在
- `ProductionBatch.id` 不存在
- 设计变更与目标批次不相关
- 无法展开受影响新物料对应的 MBOM 子树
