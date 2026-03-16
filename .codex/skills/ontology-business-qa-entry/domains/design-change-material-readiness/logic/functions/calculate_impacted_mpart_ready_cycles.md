# Function Logic

metadata_id:
- `calculate_impacted_mpart_ready_cycles`

输入:
- `switch_scope.batchQty`
- `expanded_mpart_tree[].MBOMNode.id`
- `expanded_mpart_tree[].MBOMNode.parentNodeId`
- `expanded_mpart_tree[].MBOMNode.depth`
- `expanded_mpart_tree[].MBOMNode.cumulativeQtyPerTop`
- `expanded_mpart_tree[].MBOMNode.quantityPerParent`
- `expanded_mpart_tree[].MPart.id`
- `expanded_mpart_tree[].MPart.partKind`
- `inventory_bindings`
- `purchase_order_bindings`
- `certification_bindings`
- `Context.now`

输出:
- `impacted_mpart_ready_cycles`

前置约束:
- `expanded_mpart_tree` 已包含每个 `MBOMNode` 对应的 `MPart`
- `expanded_mpart_tree` 可以按 `MBOMNode.depth` 从大到小处理

逻辑体:
1. 设 `result_list = []`
2. 对 `expanded_mpart_tree` 中按 `MBOMNode.depth` 从大到小排序的每个 `node` 执行
   - 设 `required_qty = switch_scope.batchQty * node.MBOMNode.cumulativeQtyPerTop`
   - 设 `node_inventory_position` = 从 `inventory_bindings` 中选取 `MPart.id = node.MPart.id` 的 `InventoryPosition`
   - 设 `node_inventory_lots` = 从 `inventory_bindings` 中选取 `MPart.id = node.MPart.id` 的 `InventoryLot`
   - 设 `node_purchase_orders` = 从 `purchase_order_bindings` 中选取 `MPart.id = node.MPart.id` 的 `PurchaseOrder`
   - 设 `node_certifications` = 从 `certification_bindings` 中选取 `MPart.id = node.MPart.id` 的 `ProcurementCertification`
   - 调用 `assess_mpart_inventory_coverage(required_qty, node_inventory_position, node_inventory_lots)` 作为 `inventory_coverage`
   - 如果 `node.MPart.partKind = "leaf"`
     则
     - 调用 `calculate_leaf_mpart_ready_cycle(node.MPart, inventory_coverage, node_purchase_orders, node_certifications, Context.now)` 作为 `part_ready_cycle`
   - 否则
     - 设 `child_cycles` = 从 `result_list` 中选取 `parentMbomNodeId = node.MBOMNode.id` 的下层结果
     - 调用 `roll_up_assembly_ready_cycle(node.MPart, inventory_coverage, child_cycles, Context.now)` 作为 `part_ready_cycle`
   - 设 `part_ready_cycle.mpartId = node.MPart.id`
   - 设 `part_ready_cycle.mbomNodeId = node.MBOMNode.id`
   - 设 `part_ready_cycle.parentMbomNodeId = node.MBOMNode.parentNodeId`
   - 设 `part_ready_cycle.requiredQty = required_qty`
   - 设 `part_ready_cycle.inventoryCoverage = inventory_coverage`
   - 将 `part_ready_cycle` 追加到 `result_list`
3. 返回 `impacted_mpart_ready_cycles = result_list`

失败条件:
- `expanded_mpart_tree` 为空
- 某个节点缺少 `MBOMNode.quantityPerParent`
- 某个节点缺少 `MBOMNode.depth`
- 某个节点缺少 `MBOMNode.cumulativeQtyPerTop`
