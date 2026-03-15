# Palantir Ontology 相关概念参考

## 文档目的

本文用于整理 Palantir 官方文档中与 Ontology 相关的核心概念，作为当前 `ontology-supply-chain-demo-v1` 方案的外部参考材料。

本文内容分为两类：

- `官方定义整理`：基于 Palantir 官方文档的归纳性总结。
- `对本项目的启发`：结合本项目场景的理解，不代表 Palantir 原文表述。

## 一、总览：Palantir 如何理解 Ontology

### 官方定义整理

- Palantir 将 Ontology 描述为组织的运行时业务层，可以理解为建立在底层数字资产之上的业务语义和行动层。
- Ontology 位于数据集、虚拟表、模型等数字资产之上，并把这些资产连接到现实世界中的对象、事件和业务概念。
- 在很多场景里，Ontology 可以充当组织的数字孪生，不只表达“数据是什么”，还表达“业务如何运作、如何决策、如何变更”。
- Palantir 将 Ontology 明确拆成两类元素：
  - `语义元素`：`objects`、`properties`、`links`
  - `动态元素`：`actions`、`functions`、`dynamic security`
- 在架构层面，Palantir 还强调 Ontology 不是单纯表示数据，而是用来承载企业中复杂、相互关联的决策与运营流程。

### 对本项目的启发

- 本项目不应把“本体”做成一个静态词典或知识图谱壳子，而应把它定义为智能系统的运行时业务语义层。
- 问答、分析、规划和后续自动执行都应共享同一份 Ontology，而不是各做一套语义模型。
- 如果后续要继续贴近 Palantir 路线，系统设计重点应落在“语义层 + 行动层 + 治理边界”的统一，而不是形式推理。

## 二、核心概念

### 1. Object Type / Object / Object Set

#### 官方定义整理

- `Object type` 是现实世界实体或事件的 schema 定义。
- `Object` 或 `Object instance` 是某个对象类型的单个实例，对应一个具体实体或具体事件。
- `Object set` 是多个对象实例构成的集合。
- Palantir 的建模重点不是把表直接暴露给用户，而是把底层数据映射为业务对象。

#### 对本项目的启发

- 本项目中的 `Product`、`Warehouse`、`Shipment`、`PurchaseOrder` 等都应首先被定义为业务对象，而不是数据表别名。
- 业务问答和规划都应尽量围绕对象、对象集合和对象之间的关系展开。

### 2. Property

#### 官方定义整理

- `Property` 是对象类型上的字段或属性，用于承载对象的业务信息。
- Palantir 在 Ontology 中不仅定义属性，还强调属性上的展示元数据、格式、约束、派生属性与治理能力。

#### 对本项目的启发

- 本项目中的属性不应只包含存储字段，还应补充解释信息，例如业务含义、单位、更新时间、可用于哪些分析或规划步骤。
- 后续若要增强解释能力，可以把“证据链中的字段含义”也绑定到属性层。

### 3. Link Type / Link

#### 官方定义整理

- `Link type` 是两个对象类型之间关系的 schema 定义。
- `Link` 是该关系的单个实例。
- Palantir 明确把 link type 类比为数据层的 join 定义，但它不是抽象 join，而是绑定到组织真实业务关系上的关系类型。
- Link 可以连接不同对象类型，也可以连接同一对象类型。

#### 对本项目的启发

- 本项目中的“库存属于某仓某 SKU”“采购单来自某供应商”“在途补给面向某仓”都应优先表达为 link，而不是临时在查询逻辑里硬编码。
- 规划器如果要解释“为什么建议调拨”或“为什么建议补货”，通常需要沿 link 追溯上下游对象和依赖关系。

### 4. Function

#### 官方定义整理

- `Function` 是可在服务端执行的业务逻辑单元。
- Functions 支持直接基于 Ontology 编写逻辑，例如读取对象属性、遍历 links，必要时也能做 Ontology edits。
- 官方文档强调，Functions 用于在运营上下文中快速执行逻辑，适合支撑仪表盘、应用和决策流程。
- 在 Ontology 总览中，Functions 被归入动态元素，用于承载复杂业务逻辑。

#### 对本项目的启发

- 本项目中更适合将 `Function` 理解为“可解释的业务分析与推导逻辑”，例如库存覆盖天数、缺货判断、ETA 偏差分析、风险评分等。
- 不建议把所有编排步骤都叫 Function；否则 Function 会同时承担“分析函数”和“工作流动作”两类职责，边界会变模糊。

### 5. Action Type / Action

#### 官方定义整理

- `Action` 是一次单事务业务变更，用于修改一个或多个对象、属性或 links。
- `Action type` 是该类变更的定义，通常包含参数、规则以及提交时的 side effects。
- Palantir 的设计重点是让用户围绕业务目标执行变更，而不是直接追逐底层字段编辑。
- 当简单规则不足以描述复杂变更逻辑时，Action type 可以调用 Function，这就是 `function-backed action`。
- Action 还支持 side effects，用于通知用户或通过 webhook 连接外部系统，这类模式被官方称为某种“decision orchestration”。

#### 对本项目的启发

- 本项目中的 `跨仓调拨`、`加急运输`、`补货下单`、`通知运营` 更适合被建模为 `ActionType`，而不是仅仅作为自然语言建议。
- 如果要让规划结果显得像“能落地的动作图”而不是“顾问式建议列表”，每个 ActionType 至少应声明：
  - 作用对象
  - 输入参数
  - 前置条件
  - 预期效果
  - 限制条件
  - 模拟执行方式
- 后续如果需要接真实系统，可以沿着 Palantir 的思路把外部系统集成放在 action side effects 上。

### 6. Interface

#### 官方定义整理

- `Interface` 是一种 Ontology type，用于描述一类对象的共同 shape 和 capability。
- 一个 interface 可以被多个 object type 实现，也可以被扩展。
- 接口的意义在于让不同对象类型在共享结构和能力时具备一致的建模与交互方式。
- Palantir 明确把 interfaces 视为对象多态能力的一部分。

#### 对本项目的启发

- 如果本项目后续要从单场景扩展到多场景，`Interface` 会很有价值。
- 例如可以抽象出：
  - `StockHoldingNode`
  - `ReplenishableEntity`
  - `TransportableAsset`
  - `RiskManagedObject`
- 这样问答模板、分析函数、规划动作就不必全部绑死在具体对象类型上。

### 7. Dynamic Security

#### 官方定义整理

- Palantir 在 Ontology 总览里把 `dynamic security` 与 actions、functions 一起归入动态元素。
- 这反映出其设计并不把治理视为外围能力，而是认为治理与业务动作、业务逻辑一样，是 Ontology 的组成部分。

#### 对本项目的启发

- 本项目即使 v1 不做完整权限体系，也应尽早为以下能力预留位置：
  - 哪些对象可见
  - 哪些动作可执行
  - 哪些计划建议可展示
  - 哪些字段只能解释不能修改

### 8. Object Edits / System of Record / Decision Orchestration

#### 官方定义整理

- Palantir 把对象编辑看成 Ontology 驱动运营流程的一部分，用户可以通过 Actions 对对象、属性和 links 做变更。
- 当 Ontology 自身是某个流程的系统记录时，Actions 直接表达业务变更。
- 当外部系统仍是源系统时，Action side effects 可以把业务决策编排到外部系统中，这对应“decision orchestration”的模式。

#### 对本项目的启发

- 这给本项目提供了一个很清晰的演进路线：
  - `v1`：只做只读 Ontology + 模拟 Action 规划
  - `v2`：支持模拟执行和 action log
  - `v3`：通过 side effects 对接 ERP/WMS/TMS 等真实系统

### 9. AI / Agent 与 Ontology 的关系

#### 官方定义整理

- Palantir 的 AIP Analyst 允许用户用自然语言对 Ontology 做临时分析。
- 在官方描述中，Agent 会围绕 Ontology 做对象发现、对象搜索、对象集合创建、聚合、SQL 分析和可视化生成。
- 这说明 Ontology 在 Palantir 体系里不是 AI 的背景知识库，而是 AI 工作时的结构化业务上下文和工具空间。

#### 对本项目的启发

- 本项目中的大模型不应绕开 Ontology 直接回答业务问题。
- 更贴近 Palantir 的方式是：
  - 先基于 Ontology 做对象/关系/动作/函数的定位
  - 再调用分析与规划工具
  - 最后由模型做语言组织与解释

## 三、概念之间的关系

可以把 Palantir 的 Ontology 粗略理解为：

```text
Ontology
├─ 语义层
│  ├─ Object Type
│  ├─ Property
│  ├─ Link Type
│  └─ Interface
└─ 动态层
   ├─ Function
   ├─ Action Type
   └─ Dynamic Security
```

如果用一句更工程化的话概括：

```text
Object / Property / Link / Interface
= 业务世界“是什么”

Function
= 业务逻辑“怎么分析/怎么计算”

Action Type
= 业务世界“怎么改变”

Dynamic Security
= 在什么边界下允许理解、分析和改变
```

## 四、对本项目最值得保留的 Palantir 思路

### 官方定义整理后的高价值原则

- Ontology 的价值不只是“统一语义”，而是把语义、逻辑、动作和治理统一到一个运行时层。
- 用户与 AI 都应围绕对象、关系、函数、动作开展工作，而不是直接面向底层表和字段。
- 复杂业务流程不应只依赖文本推理，而应依赖受约束的对象模型、业务逻辑和动作模型。

### 对本项目的建议归纳

- 将当前系统定义为“基于本体的智能数据管理与业务操作系统”，而不只是“问答机器人”。
- 在元模型上明确区分：
  - `Object / Link`：业务对象及关系
  - `Function`：业务推导逻辑
  - `ActionType`：合法业务动作
  - `Constraint / Security`：约束与治理边界
- 问答、分析、规划、重规划都应落在同一份 Ontology 上。
- 如果后续需要更贴近 Palantir，可补充：
  - `Interface`
  - `Action side effects`
  - `Action log / execution history`
  - `面向 Agent 的工具化 Ontology 查询与分析接口`

## 五、官方参考链接

- Ontology 总览：https://www.palantir.com/docs/foundry/ontology/overview
- Ontology 架构说明：https://www.palantir.com/docs/foundry/architecture-center/ontology-system
- Object types 总览：https://www.palantir.com/docs/foundry/object-link-types/object-types-overview
- Link types 总览：https://www.palantir.com/docs/foundry/object-link-types/link-types-overview
- Functions 总览：https://www.palantir.com/docs/foundry/functions/overview
- Action types 总览：https://www.palantir.com/docs/foundry/action-types/overview
- Function-backed actions：https://www.palantir.com/docs/foundry/action-types/function-actions-overview
- Action side effects：https://www.palantir.com/docs/foundry/action-types/side-effects-overview
- Object edits 总览：https://www.palantir.com/docs/foundry/object-edits/overview
- Interfaces 总览：https://www.palantir.com/docs/foundry/interfaces/interface-overview
- AIP Analyst 总览：https://www.palantir.com/docs/foundry/aip-analyst/overview
