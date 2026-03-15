## ADDED Requirements

### Requirement: 供应链运行时本体模型
系统 MUST 提供一套面向供应链/运营 Demo 的运行时本体模型，至少包含 `ObjectType`、`RelationType`、`Metric`、`Function`、`Constraint`、`ActionType` 六类静态语义元素，以及 `ObjectInstance`、`Event`、`StateSnapshot`、`Task`、`Plan`、`ActionExecution` 六类动态语义元素。系统 MUST 预置 `Product`、`Warehouse`、`InventoryPosition`、`Shipment`、`PurchaseOrder`、`Supplier`、`DemandSignal`、`RiskAlert` 等对象类型，并为每类对象提供名称、业务定义、关键属性和关联关系描述。

#### Scenario: 加载缺货分析所需本体
- **WHEN** 系统初始化供应链 Demo 的本体定义
- **THEN** 系统返回包含对象类型、关系类型、函数、指标、约束和动作类型的完整语义模型

### Requirement: 本体语义可查询且可解释
系统 MUST 提供只读查询能力，用于按对象类型、动作类型、函数或关系检索本体语义，并返回适合 UI 展示的解释信息。解释信息 MUST 至少包含语义名称、业务含义、输入输出、适用范围以及与其他语义元素的关联。

#### Scenario: 查询调拨动作的语义解释
- **WHEN** 前端请求查看 `跨仓调拨` 动作的定义
- **THEN** 系统返回该动作的业务含义、适用对象、前置条件、预期影响和关联约束

### Requirement: 业务数据必须映射到本体实例
系统 MUST 能够将模拟业务数据映射为本体实例和状态快照，使分析和规划在统一语义上下文中运行。该映射 MUST 保留业务主键与本体实例标识之间的关联，但 MUST NOT 在分析过程中修改静态本体定义。

#### Scenario: 将库存与在途记录映射为实例
- **WHEN** 系统载入某仓某 SKU 的库存、在途和采购数据
- **THEN** 系统生成对应的对象实例、事件或状态快照，并保持这些实例与原始业务记录的映射关系

### Requirement: 规划器只能使用声明过的动作类型
系统 MUST 通过本体向规划器暴露合法动作边界。每个 `ActionType` MUST 声明目标对象类型、输入参数、前置条件、预期效果和适用限制。规划器 MUST NOT 生成任何未在本体中声明的动作。

#### Scenario: 规划器请求可用动作
- **WHEN** 规划器为缺货风险生成处置方案
- **THEN** 系统只返回已经在本体中声明的动作类型及其约束，不返回未定义动作
