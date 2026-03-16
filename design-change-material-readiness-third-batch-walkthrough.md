# 业务 Agent 处理报告：设计变更第三批次物料可用周期

## 分析结论

- 当前设计变更单 `DCO-2026-017` 可以从第三批次 `PB-003` 开始切换。
- 涉及的新物料整体可用周期为 `100` 小时。
- 物料整体准备完成时间为 `2026-03-20 13:00:00 +08:00`，早于第三批次切换时间 `2026-03-20 16:00:00 +08:00`。
- 最终瓶颈是上层装配件“控制模块 A2”，其准备周期为 `100` 小时。
- 如果只看底层新件，主要瓶颈是采购件“温度传感器 S2”，准备周期为 `84` 小时。

## 问题判断

- 问题类型：`已知业务流程类问题`
- 选中 domain：`design-change-material-readiness`
- 能力判断：现有能力可直接处理，使用现有 action `create_change_switch_material_readiness_report(...)` 及配套函数即可完成分析，无需新增 function/action。

## 逻辑流程

1. 工具：`discover_domains()`
   目的：确定问题所属业务域。
   结果：命中 `design-change-material-readiness`。

2. 工具：`get_capability_metadata("design-change-material-readiness", "create_change_switch_material_readiness_report")`
   目的：判断现有能力是否覆盖“第三批次切换物料可用周期分析”。
   结果：确认现有 action 和配套函数足以处理该问题。

3. 工具：`query_instances_by_type(...)`
   目的：读取“设计变更单”和“生产批次”两个锚点对象。
   结果：定位到当前设计变更单 `DCO-2026-017` 和第三批次 `PB-003`。

4. 工具：`query_instances_by_path(..., "change-to-relevant-impact-items-for-batch", ...)`
   目的：沿“设计变更单 -> 设计变更受影响对象 -> 设计 BOM 节点 -> 产品型号 -> 生产批次”确认第三批次是否在变更影响范围内。
   结果：命中受影响对象，确认第三批次属于本次设计变更的切换范围。

5. 工具：`query_instances_by_path(..., "impact-item-to-new-mparts", ...)`
   目的：沿“设计变更受影响对象 -> 新设计零件版本 -> 制造 BOM 节点 -> 新制造件”找到切换后的新制造件。
   结果：定位到新装配件“控制模块 A2”。

6. 工具：`query_instances_by_path(..., "batch-to-line-state", ...)`
   目的：读取第三批次对应的生产线状态。
   结果：确认第三批次切换时间点和所属产线，用于后续切换上下文归一化。

7. 工具：`normalize_change_batch_scope(...)`
   目的：归一化切换上下文，包括设计变更、目标批次、切换时间和新物料目标。
   结果：形成统一的切换范围，批量为 `120`，切换点为 `2026-03-20 16:00:00 +08:00`。

8. 工具：`query_instances_by_path(..., "mpart-to-mbom-subtree", ...)`
   目的：沿“新制造件 -> 制造 BOM 子树 -> 下层制造件”展开完整受影响新物料结构。
   结果：展开出“控制模块 A2”“温度传感器 S2”“固定支架 B2”“密封圈 55C”。

9. 工具：`query_instances_by_path(..., "mpart-to-inventory", ...)`
   目的：读取这些新物料的库存位置和库存批次。
   结果：识别出温度传感器和固定支架库存不足，密封圈库存充足，控制模块 A2 自身库存也不足以覆盖整批切换。

10. 工具：`query_instances_by_path(..., "mpart-to-purchase-and-certification", ...)`
    目的：读取采购件的采购订单和采购认证状态。
    结果：识别出“温度传感器 S2”存在在途采购订单，但采购认证尚未完成，是底层物料的主要瓶颈。

11. 工具：`calculate_impacted_mpart_ready_cycles(...)`
    目的：按制造 BOM 自底向上计算各层新物料准备周期。
    结果：
    - 温度传感器 S2：`84` 小时
    - 固定支架 B2：`36` 小时
    - 密封圈 55C：`0` 小时
    - 控制模块 A2：`100` 小时

12. 工具：`build_change_material_readiness_report(...)`
    目的：生成面向业务的分析结论。
    结果：输出“第三批次可切换，整体物料可用周期 `100` 小时，最终瓶颈为控制模块 A2”的报告结论。
