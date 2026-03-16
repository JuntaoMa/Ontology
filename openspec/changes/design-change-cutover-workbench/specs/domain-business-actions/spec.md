## ADDED Requirements

### Requirement: action 元数据与逻辑体必须分离
系统 MUST 将 action 的元数据放在 `actions.json`，并将具体编排逻辑放在 `logic/actions/*.md`。

#### Scenario: 查看设计变更 domain 的 action
- **WHEN** agent 读取 `design-change-material-readiness/schema/actions.json`
- **THEN** 可以看到 action 的输入输出、依赖查询工具、依赖函数和 `logicRef`
- **AND** 需要读取 `logic/actions/*.md` 才能看到完整编排

### Requirement: design-change-material-readiness 必须提供已知业务 action
系统 MUST 为 `design-change-material-readiness` 提供一个已落地 action：`create_change_switch_material_readiness_report`。

#### Scenario: 处理第三批次物料可用周期问题
- **WHEN** agent 处理第三批次切换的新物料可用周期问题
- **THEN** 可以直接使用 `create_change_switch_material_readiness_report` 组织完整流程

### Requirement: 已知业务 action 必须显式声明查询链和函数链
已知业务 action MUST 明确声明自己依赖哪些统一入口和 function，以及这些步骤的前后顺序、输入承接关系和失败条件。

#### Scenario: 查看物料可用周期 action
- **WHEN** agent 读取 `create_change_switch_material_readiness_report` 的逻辑体
- **THEN** 能明确看到从“读取设计变更单”到“生成物料可用周期报告”的完整链路

### Requirement: action 默认只做 dry-run 级分析编排
系统 MUST 将当前 action 限制在 dry-run 级别，不得在现阶段直接触发外部写操作。

#### Scenario: 用户要求执行真实切换
- **WHEN** 用户要求系统直接写回生产系统或执行真实切换
- **THEN** 系统明确说明当前 action 只支持分析与报告

### Requirement: 能力缺口场景必须支持临时编排与新 capability 展示
系统 MUST 允许在 action 不存在或 function 不足时，通过统一入口完成临时编排，并在结果中显式展示新增 capability 草案。

#### Scenario: 处理旧物料报废成本问题
- **WHEN** agent 处理第三批次切换的旧物料报废成本问题
- **THEN** 系统可以先复用现有查询能力，再用新增 `calculate_old_material_scrap_cost(...)` 草案和临时编排输出业务报告
