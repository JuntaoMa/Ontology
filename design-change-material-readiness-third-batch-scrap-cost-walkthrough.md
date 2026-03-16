# 业务 Agent 处理报告：设计变更第三批次旧物料报废成本

## 分析结论

- 当前设计变更单 `DCO-2026-017` 从第三批次 `PB-003` 开始切换时，命中的旧件处置意见为“报废”。
- 需报废的旧制造件为“控制模块 A1”。
- 旧件库存批次可用量为 `24`，库存批次账面单价为 `760 RMB`。
- 本次旧物料报废成本为 `18240 RMB`。

## 问题判断

- 问题类型：`能力缺口业务流程类问题`
- 选中 domain：`design-change-material-readiness`
- 能力判断：现有数据模型、路径模板和查询能力足以定位旧件、处置意见和库存事实；当前只缺一个正式计算函数 `calculate_old_material_scrap_cost(...)`。查询与结果汇总可以由主入口临时编排完成，不需要额外补查询能力。

## 逻辑流程

1. 工具：`discover_domains()`
   目的：确定问题所属业务域。
   结果：命中 `design-change-material-readiness`。

2. 工具：`assess_problem_capability_fit("design-change-material-readiness", problem_statement)`
   目的：判断现有能力是否能直接回答“第三批次切换旧物料报废成本”。
   结果：确认查询能力足够，但缺少正式的报废成本计算函数。

3. 工具：`query_instances_by_type(...)`
   目的：读取“设计变更单”和“生产批次”两个锚点对象。
   结果：定位到当前设计变更单 `DCO-2026-017` 和第三批次 `PB-003`。

4. 工具：`query_instances_by_path(..., "change-to-relevant-impact-items-for-batch", ...)`
   目的：沿“设计变更单 -> 设计变更受影响对象 -> 设计 BOM 节点 -> 产品型号 -> 生产批次”确认第三批次处于本次设计变更影响范围内。
   结果：命中受影响对象，确认第三批次需要处理该设计变更。

5. 工具：`query_instances_by_path(..., "impact-item-to-old-part-disposition", ...)`
   目的：沿“设计变更受影响对象 -> 旧设计零件版本”读取旧件处置意见。
   结果：命中“报废”处置意见，确认本问题需要进入报废成本计算。

6. 工具：`query_instances_by_path(..., "impact-item-to-old-mparts", ...)`
   目的：沿“设计变更受影响对象 -> 旧设计零件版本 -> 旧制造件”定位需要报废的旧制造件。
   结果：定位到旧制造件“控制模块 A1”。

7. 工具：`query_instances_by_path(..., "mpart-to-inventory", ...)`
   目的：沿“旧制造件 -> 库存位置 / 库存批次”读取报废数量和成本依据。
   结果：读取到旧件库存批次可用量 `24`、库存批次账面单价 `760 RMB`。

8. 工具：`draft_new_capability("design-change-material-readiness", problem_statement)`
   目的：补齐缺失的报废成本计算能力。
   结果：生成新增函数 `calculate_old_material_scrap_cost(...)`，逻辑如下：
   - 如果旧件处置意见不是“报废”，返回 `0`
   - 如果存在库存批次可用量和库存批次账面单价，按 `库存批次可用量 × 库存批次账面单价` 求和
   - 否则回退到 `库存位置可用数量 × 标准单价`
   - 如果库存事实缺失，则返回失败

9. 工具：`calculate_old_material_scrap_cost(...)`
   目的：根据旧件处置意见、旧件库存数量和成本口径计算报废成本。
   结果：报废数量 `24`，成本口径为“库存批次账面单价”，报废成本 `18240 RMB`。

10. 工具：主入口临时编排
    目的：将查询结果与新增函数计算结果整理为业务结论。
    结果：输出“第三批次切换旧物料报废成本为 `18240 RMB`”的处理结论。
