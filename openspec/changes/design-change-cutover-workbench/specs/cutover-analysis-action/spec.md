## ADDED Requirements

### Requirement: 系统必须定义完整的设计变更切换成本分析动作
系统 MUST 定义一个 `create_cutover_cost_analysis` 业务动作，用于从设计变更问题出发，串联查询工具和业务函数，输出完整的切换成本分析结果。

#### Scenario: 运行完整分析动作
- **WHEN** 智能体收到“请输出 ECN-204 的切换成本报告并推荐最佳切换批次”
- **THEN** 系统按动作契约依次完成查询规划、数据读取、函数计算、方案排序和报告组装

### Requirement: 动作必须显式声明调用链路
`create_cutover_cost_analysis` 动作 MUST 明确声明自己依赖哪些查询工具和业务函数，以及这些步骤的前后顺序、输入承接关系和失败中止条件。

#### Scenario: 查看动作编排说明
- **WHEN** 智能体读取 `create_cutover_cost_analysis` 的动作说明
- **THEN** 说明中列出该动作调用的查询步骤、函数步骤、输入来源和输出产物

### Requirement: 动作默认只做 dry-run 级编排
系统 MUST 将 `create_cutover_cost_analysis` 动作限制为 dry-run 级分析编排，不得在当前版本中直接写回 MES、锁批次或执行真实设计变更。

#### Scenario: 用户要求执行外部写操作
- **WHEN** 用户要求动作直接锁定批次或写回 MES
- **THEN** 系统明确说明该动作当前只支持分析与报告，不支持真实执行

### Requirement: 动作输出必须包含报告与解释材料
系统 MUST 让 `create_cutover_cost_analysis` 输出推荐批次、候选方案对比、关键假设、证据绑定和推荐原因，以支持 Demo 演示和后续解释。

#### Scenario: 输出分析报告
- **WHEN** 动作执行完成
- **THEN** 系统返回可展示的切换成本报告，其中包含推荐批次、候选成本对比和关键解释项
