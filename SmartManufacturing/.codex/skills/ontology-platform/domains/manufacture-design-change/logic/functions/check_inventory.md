# Function Logic

metadata_id:
- `check_inventory`

输入:
- `required_qty`
- `InventoryPosition.onHandQty`
- `InventoryPosition.reservedQty`
- `InventoryPosition.safeStockQty`
- `InventoryLotList[].availableQty`

输出:
- `inventory_coverage`

前置约束:
- `required_qty` 为当前批次切换所需数量

逻辑体:
1. 设 `position_available_qty` = `max(InventoryPosition.onHandQty - InventoryPosition.reservedQty - InventoryPosition.safeStockQty, 0)`
2. 设 `lot_available_qty` = `sum(InventoryLotList[].availableQty)`
3. 如果 `lot_available_qty > 0`
   则
   - 设 `effective_available_qty` = `lot_available_qty`
4. 否则
   - 设 `effective_available_qty` = `position_available_qty`
5. 设 `uncovered_qty` = `max(required_qty - effective_available_qty, 0)`
6. 设 `enough_inventory` = `uncovered_qty = 0`
7. 返回 `inventory_coverage`
   - `inventory_coverage.availableQty = effective_available_qty`
   - `inventory_coverage.uncoveredQty = uncovered_qty`
   - `inventory_coverage.enough = enough_inventory`

失败条件:
- `required_qty` 缺失
- `InventoryPosition` 与 `InventoryLotList` 都为空
