# Function Logic

metadata_id:
- `calc_assembly_ready`

输入:
- `MPart.id`
- `MPart.partKind`
- `MPart.assemblyLeadHours`
- `MPart.makeLeadHours`
- `inventory_coverage.uncoveredQty`
- `child_ready_cycles[].readyCycleHours`
- `Context.now`

输出:
- `assembly_ready_cycle`

前置约束:
- 当前 `MPart.partKind = "assembly"`

逻辑体:
1. 如果 `inventory_coverage.uncoveredQty <= 0`
   则
   - 设 `assembly_ready_cycle.mpartId = MPart.id`
   - 设 `assembly_ready_cycle.readyCycleHours = 0`
   - 设 `assembly_ready_cycle.readyAt = Context.now`
   - 设 `assembly_ready_cycle.reason = "inventory_enough"`
   - 返回 `assembly_ready_cycle`
2. 设 `child_max_cycle` = `max(child_ready_cycles[].readyCycleHours)`
3. 如果 `MPart.assemblyLeadHours` 存在
   则
   - 设 `assembly_lead` = `MPart.assemblyLeadHours`
4. 否则
   - 设 `assembly_lead` = `MPart.makeLeadHours`
5. 设 `assembly_ready_cycle.readyCycleHours = child_max_cycle + assembly_lead`
6. 设 `assembly_ready_cycle.mpartId = MPart.id`
7. 设 `assembly_ready_cycle.readyAt = add_hours(Context.now, assembly_ready_cycle.readyCycleHours)`
8. 设 `assembly_ready_cycle.reason = "max_child_cycle_plus_assembly"`
9. 返回 `assembly_ready_cycle`

失败条件:
- `child_ready_cycles` 为空
- `MPart.assemblyLeadHours` 和 `MPart.makeLeadHours` 同时缺失
