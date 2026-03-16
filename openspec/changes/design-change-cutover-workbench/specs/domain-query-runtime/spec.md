## ADDED Requirements

### Requirement: 每个 domain 必须用 domain pack 方式组织查询相关资产
系统 MUST 将每个业务域的查询相关资产放在同一个 domain pack 内，并通过 manifest 统一声明其位置。

#### Scenario: 加载设计变更 domain
- **WHEN** agent 读取 `design-change-material-readiness` 的 manifest
- **THEN** 可以定位到 `data-model.json`、`functions.json`、`actions.json`、`path-templates.json` 和对应的 `logic/` 目录

### Requirement: schema 必须拆分为数据模型、函数元数据、动作元数据和路径模板
系统 MUST 将 schema 明确拆成 `data-model.json`、`functions.json`、`actions.json` 和 `path-templates.json`，不得将逻辑体直接写进 schema JSON。

#### Scenario: 查看旧物料报废成本所需数据路径
- **WHEN** agent 需要定位旧物料处置意见、旧制造件和库存事实
- **THEN** 可以分别从数据模型和路径模板中找到所需对象、边和路径，而不是在 schema 中读取混杂的计算逻辑

### Requirement: 查询入口必须以统一高层操作语义呈现
系统 MUST 提供统一入口来完成 domain 发现、schema 查看、路径模板查看、按类型查实例、按路径查实例、能力匹配和新能力草案生成。

#### Scenario: 先做能力匹配再查数
- **WHEN** agent 处理旧物料报废成本问题
- **THEN** 可以先使用 `assess_problem_capability_fit(...)` 判断能力缺口，再继续查询实例数据

### Requirement: 路径模板必须显式声明起点、终点、路径和返回字段
系统 MUST 让每条路径模板至少包含 `startType`、`targetType`、`path` 和 `returns`，以便 agent 能稳定复用。

#### Scenario: 通过路径模板找到旧件处置意见
- **WHEN** agent 使用 `impact-item-to-old-part-disposition`
- **THEN** 能明确知道路径从“设计变更受影响对象”出发，到“旧设计零件版本”结束，并返回旧件处置意见相关字段

### Requirement: 查询工具必须只负责读数和绑定
系统 MUST 将查询工具限制在对象定位、路径扩展、字段绑定和证据保留范围内，不得在查询工具内部直接给出业务结论。

#### Scenario: 读取旧制造件库存
- **WHEN** agent 使用 `mpart-to-inventory` 读取旧制造件库存
- **THEN** 查询结果只返回库存位置、库存批次和相关字段，不直接给出“报废成本”

### Requirement: 查询结果必须保留证据绑定
系统 MUST 在查询结果中保留对象、关系路径和关键字段绑定，以供后续 function、action 和最终报告复用。

#### Scenario: 为报废成本函数准备输入
- **WHEN** agent 已查询到旧件处置意见、旧制造件和库存批次
- **THEN** 查询结果可直接作为 `calculate_old_material_scrap_cost(...)` 的输入证据
