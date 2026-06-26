## ADDED Requirements

### Requirement: Domain shall define Function as first-class capability resources
每个 domain SHALL 使用 `Function` 作为业务计算、归一化、评估、汇总和转换能力的标准定义方式。

#### Scenario: Function 元数据完整声明能力边界
- **WHEN** 一个 domain 定义新的 function
- **THEN** 该 function 必须在 `ontology/functions.json` 中声明 `id`、`name`、`summary`、`inputs`、`outputs`、`capabilityBoundary` 和 `logicRef`

### Requirement: Domain shall define Action as first-class capability resources
每个 domain SHALL 使用 `Action` 作为业务问题编排和控制流入口的标准定义方式。

#### Scenario: Action 元数据完整声明编排入口
- **WHEN** 一个 domain 定义新的 action
- **THEN** 该 action 必须在 `ontology/actions.json` 中声明 `id`、`name`、`summary`、`inputs`、`outputs`、`capabilityBoundary` 和 `logicRef`

### Requirement: Capability resources shall declare explicit dependencies on ontology resources
每个 `Function` 与 `Action` SHALL 显式声明其依赖的对象、关系和其他能力，供 agent 做能力发现与匹配。

#### Scenario: Function 声明对象和关系依赖
- **WHEN** 一个 function 需要读取对象或遍历关系
- **THEN** 它必须显式声明 `readsObjects`、`traversesLinks`、`writesObjects` 和 `callsFunctions` 中的相关依赖，而不能只在逻辑体中隐含表达

#### Scenario: Action 声明锚点和下游依赖
- **WHEN** 一个 action 以某类业务对象为入口编排能力
- **THEN** 它必须显式声明 `anchorObjects`、`readsObjects`、`traversesLinks`、`writesObjects`、`dependsOnFunctions` 和 `dependsOnActions` 中的相关依赖
