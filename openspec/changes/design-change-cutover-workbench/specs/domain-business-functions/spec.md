## ADDED Requirements

### Requirement: function 元数据与逻辑体必须分离
系统 MUST 将 function 的元数据放在 `functions.json`，并将具体逻辑体放在 `logic/functions/*.md`。

#### Scenario: 查看设计变更 domain 的 function
- **WHEN** agent 读取 `design-change-material-readiness/schema/functions.json`
- **THEN** 只能看到函数名称、输入输出、边界和 `logicRef`
- **AND** 需要进一步读取 `logic/functions/*.md` 才能看到具体逻辑

### Requirement: function 逻辑体必须采用结构化中文表达
系统 MUST 用结构化中文表达 function 逻辑体，并保持属性、边和函数调用的本体对齐格式。

#### Scenario: 阅读“计算底层制造零件可用周期”逻辑
- **WHEN** agent 读取 `calculate_leaf_mpart_ready_cycle` 的逻辑文件
- **THEN** 可以看到以“如果 / 否则 / 调用 / 返回”等语句表达的逻辑体，并且属性仍写成 `Class.property`

### Requirement: function 不得隐式查询底层数据
每个 function MUST 只消费显式输入，不得在函数内部再去读取实例、路径模板或外部数据源。

#### Scenario: 计算旧物料报废成本
- **WHEN** agent 调用 `calculate_old_material_scrap_cost(...)`
- **THEN** 该函数只使用旧件处置意见、库存数量和成本字段，不在内部自行查询库存

### Requirement: design-change-material-readiness 必须提供物料可用周期主链路函数
系统 MUST 为 `design-change-material-readiness` 提供一组已落地函数，至少包括：
- `normalize_change_batch_scope`
- `assess_mpart_inventory_coverage`
- `calculate_leaf_mpart_ready_cycle`
- `roll_up_assembly_ready_cycle`
- `calculate_impacted_mpart_ready_cycles`
- `build_change_material_readiness_report`

#### Scenario: 计算第三批次新物料可用周期
- **WHEN** agent 处理第三批次切换的新物料可用周期问题
- **THEN** 这些函数足以支撑从切换范围归一化到最终报告生成的完整链路

### Requirement: 能力缺口场景必须允许生成功能草案
系统 MUST 允许在现有 function 不足时，通过 `draft_new_capability(...)` 生成新的 function 草案和逻辑体草案。

#### Scenario: 为旧物料报废成本补函数
- **WHEN** agent 处理第三批次切换的旧物料报废成本问题
- **THEN** 系统可以生成 `calculate_old_material_scrap_cost(...)` 的草案，并用它支撑临时业务报告
