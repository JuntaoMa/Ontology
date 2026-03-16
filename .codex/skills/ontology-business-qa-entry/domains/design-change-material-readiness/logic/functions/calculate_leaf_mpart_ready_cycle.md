# Function Logic

metadata_id:
- `calculate_leaf_mpart_ready_cycle`

输入:
- `MPart.id`
- `MPart.sourceType`
- `MPart.partKind`
- `MPart.makeLeadHours`
- `MPart.procurementLeadHours`
- `MPart.procurementCertificationRequired`
- `MPart.certificationLeadHours`
- `inventory_coverage.uncoveredQty`
- `PurchaseOrderList[].remainingQty`
- `PurchaseOrderList[].promisedAt`
- `ProcurementCertificationList[].status`
- `ProcurementCertificationList[].remainingLeadHours`
- `Context.now`

输出:
- `leaf_ready_cycle`

前置约束:
- 当前 `MPart.partKind = "leaf"`

逻辑体:
1. 如果 `inventory_coverage.uncoveredQty <= 0`
   则
   - 设 `leaf_ready_cycle.mpartId = MPart.id`
   - 设 `leaf_ready_cycle.readyCycleHours = 0`
   - 设 `leaf_ready_cycle.readyAt = Context.now`
   - 设 `leaf_ready_cycle.reason = "inventory_enough"`
   - 返回 `leaf_ready_cycle`
2. 如果 `MPart.sourceType = "self_make"`
   则
   - 设 `leaf_ready_cycle.mpartId = MPart.id`
   - 设 `leaf_ready_cycle.readyCycleHours = MPart.makeLeadHours`
   - 设 `leaf_ready_cycle.readyAt = add_hours(Context.now, MPart.makeLeadHours)`
   - 设 `leaf_ready_cycle.reason = "self_make_lead_time"`
   - 返回 `leaf_ready_cycle`
3. 如果 `MPart.sourceType = "procured"`
   则
   - 设 `cert_cycle` = `0`
   - 如果 `MPart.procurementCertificationRequired = true`
     则
     - 如果 `exists(ProcurementCertificationList[].status = "approved")`
       则
       - 设 `cert_cycle` = `0`
     - 否则如果 `exists(ProcurementCertificationList[].remainingLeadHours)`
       则
       - 设 `cert_cycle` = `max(ProcurementCertificationList[].remainingLeadHours)`
     - 否则如果 `MPart.certificationLeadHours` 存在
       则
       - 设 `cert_cycle` = `MPart.certificationLeadHours`
     - 否则
       - 失败 `"missing_certification_cycle"`
   - 如果 `exists(PurchaseOrderList[].remainingQty >= inventory_coverage.uncoveredQty and PurchaseOrderList[].promisedAt exists)`
     则
     - 设 `po_ready_at` = `min(PurchaseOrderList[].promisedAt where PurchaseOrder.remainingQty >= inventory_coverage.uncoveredQty)`
     - 设 `procurement_cycle` = `max(hours_between(Context.now, po_ready_at), 0)`
   - 否则
     - 设 `procurement_cycle` = `MPart.procurementLeadHours`
   - 设 `leaf_ready_cycle.mpartId = MPart.id`
   - 设 `leaf_ready_cycle.readyCycleHours = cert_cycle + procurement_cycle`
   - 设 `leaf_ready_cycle.readyAt = add_hours(Context.now, leaf_ready_cycle.readyCycleHours)`
   - 设 `leaf_ready_cycle.reason = "procured_part_lead_time"`
   - 返回 `leaf_ready_cycle`
4. 失败 `"unsupported_source_type"`

失败条件:
- `MPart.sourceType` 不存在
- `Context.now` 缺失
