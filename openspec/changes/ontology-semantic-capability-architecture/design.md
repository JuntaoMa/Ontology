## Context

当前本体问答 demo 已经具备 `domain pack`、统一入口 skill、业务 function/action 元数据和逻辑层分离的基础形态，但整体仍然沿用“数据模型层 + 能力元数据层 + 逻辑层”的组织方式。这个表述对实现方清楚，对 agent 的本体探索不够友好，尤其在以下方面已经暴露出限制：

- 业务对象与业务能力之间缺少统一发现结构，agent 需要逐个检查 function/action 才能判断能力是否匹配。
- `data-model.json` 同时承担对象、关系和查询入口语义，语义资源边界不够清楚。
- 查询辅助信息与本体核心资源混放，容易让 query runtime 与 ontology core 混淆。
- function/action 的逻辑虽然已经独立管理，但表达约束偏“固定语句集”，不利于后续扩展成更自然但依然严谨的中文逻辑体。

Palantir Ontology 的划分方式给出了一个更稳定的边界：`Object/Link` 负责定义世界中的语义资源，`Function/Action` 负责定义系统能力。当前 demo 不需要治理、权限、版本等完整能力，但适合先沿着这条边界收敛出一版轻量架构。

## Goals / Non-Goals

**Goals:**
- 将 domain 本体核心明确收敛为 `Object/Link + Function/Action` 两个资源面。
- 在不引入复杂治理层的前提下，为 agent 提供统一的异构发现结构，支持“从对象找能力”“从能力回看依赖对象”。
- 将 query runtime 从本体核心中剥离出来，明确其职责是“辅助查询与路径绑定”，而不是定义本体资源。
- 为 function/action 提供结构化自然语言逻辑体规范，允许较自然的中文表达，同时保持严谨和无歧义。
- 形成适用于后续多个业务 domain 的统一目录结构和最小元数据规范。
- 为 demo 提供一套可演示的三页式前端结构，使本体资源查看、能力编辑和 agent 推理链展示能够在同一产品叙事中串联起来。

**Non-Goals:**
- 不引入权限、审计、版本发布、proposal review 等治理面能力。
- 不要求当前阶段将逻辑体编译为代码或工作流引擎。
- 不要求在本次变更中定义所有业务 domain 的完整 schema。
- 不将 query runtime 提升为与 `Object/Link/Function/Action` 同级的本体核心资源。
- 不在当前阶段实现真正的数据导入、自动建模和持久化编辑发布流程。

## Decisions

### 1. 本体核心采用“两面四类资源”的建模方式

每个 domain 的本体核心只保留四类资源：

- `Object`
- `Link`
- `Function`
- `Action`

其中：
- `Object`、`Link` 属于语义面
- `Function`、`Action` 属于能力面

这一决策替代当前“点/边 + function/action”的实现表述。原因是点/边更偏底层图存储语言，而 `Object/Link` 更适合作为业务语义资源进行发现、说明和约束；`Function/Action` 也将从“工具清单”升级为一等能力资源。

备选方案：
- 保持当前 `data-model.json + functions.json + actions.json` 不变。未采用，因为对象与关系的本体语义仍不够明确。
- 将 query/runtime 也纳入同级资源。未采用，因为会把本体核心和 agent 使用方式混在一起。

### 2. 语义面与能力面统一管理为异构发现图

虽然 `Object/Link` 与 `Function/Action` 职责不同，但它们将统一组织到同一个 domain 的发现图中。这个图至少包含两类关系：

- 语义关系：`Object -Link-> Object`
- 能力依赖关系：
  - `Function -READS-> Object`
  - `Function -TRAVERSES-> Link`
  - `Function -WRITES-> Object`
  - `Function -CALLS-> Function`
  - `Action -USES-> Function`
  - `Action -USES-> Action`
  - `Action -READS-> Object`
  - `Action -WRITES-> Object`
  - `Action -ANCHORS_ON-> Object`

这些能力关系不要求承载完整业务语义，只需要准确表达依赖与可达性。这样 agent 在识别业务对象后，就可以沿依赖边快速发现可用能力，而不是逐个检查 function/action 的说明。

备选方案：
- 继续以列表方式独立管理对象、函数和动作。未采用，因为 agent 做能力发现的效率低，且解释链不够自然。
- 将所有关系都写进人工维护的统一图文件。未采用，因为容易和元数据漂移。

### 3. 依赖关系由 capability metadata 声明并派生生成

`Function` 与 `Action` 的 schema 不直接手写图边，而是声明依赖字段，由系统派生异构图中的能力关系。最小声明包括：

- `Function`
  - `inputs`
  - `outputs`
  - `readsObjects`
  - `traversesLinks`
  - `writesObjects`
  - `callsFunctions`
  - `capabilityBoundary`
  - `logicRef`
- `Action`
  - `inputs`
  - `outputs`
  - `anchorObjects`
  - `readsObjects`
  - `traversesLinks`
  - `writesObjects`
  - `dependsOnFunctions`
  - `dependsOnActions`
  - `capabilityBoundary`
  - `logicRef`

这样可以保持 `functions.json`、`actions.json` 作为单一事实源，同时支持后续生成一个 `capability-graph.json` 供 skill 探索使用。

备选方案：
- 在 metadata 中直接手写所有能力边。未采用，因为重复维护成本高。
- 不声明依赖字段，只依赖 logicRef 解析。未采用，因为逻辑体不适合作为结构化发现入口。

### 4. query runtime 从本体核心中拆出，作为辅助层存在

domain pack 的目录结构调整为：

```text
domains/<domain-id>/
  manifest.json
  ontology/
    objects.json
    links.json
    functions.json
    actions.json
  runtime/
    entrypoints.json
    path-templates.json
    capability-graph.json
  logic/
    functions/
    actions/
```

其中：
- `ontology/` 定义核心资源
- `runtime/` 定义统一入口、路径模板和派生发现图
- `logic/` 定义 function/action 的具体逻辑体

这一决策的目标是把“系统是什么”与“agent 怎么用它”分开。`entrypoints.json` 和 `path-templates.json` 很重要，但它们属于查询与发现时的辅助资源，不属于本体语义本身。

备选方案：
- 保持当前 `schema/` 目录，继续把所有内容混放。未采用，因为本体核心边界不清。

### 5. Object/Link 使用最小语义字段，不照搬完整平台治理属性

当前 demo 阶段只保留最小必要字段：

- `Object`
  - `id`
  - `name`
  - `summary`
  - `properties`
  - `identityFields`
  - `mainDisplayFields`
- `Link`
  - `id`
  - `name`
  - `summary`
  - `fromObject`
  - `toObject`
  - `cardinality`

不引入数据源、权限、可编辑性、生命周期等治理字段，因为这些字段在当前 demo 约束下是恒定的，写进 schema 会增加噪声。

备选方案：
- 完整照搬平台级 object/link 字段。未采用，因为当前不需要治理层。
- 继续只保留点边和属性，不升级为 object/link 语义资源。未采用，因为难以形成稳定的本体表述。

### 6. Function/Action 的逻辑体采用“严谨、无歧义的结构化中文”，而不是僵硬 DSL

逻辑体继续独立存放在 `logic/` 目录，但表达规范从“固定少量关键词”放宽为：

- 必须能明确输入、输出、依赖和结果
- 必须显式引用本体对象、属性、关系和能力
- 必须能清楚区分查询、计算、编排、判断和循环
- 必须避免模糊判断和省略引用

必须保留的显式引用规则包括：
- 属性使用 `Class.property`
- 关系路径使用 `Class -LINK-> Class`
- 函数调用使用 `func(arg1, arg2, ...)`
- 动作调用使用 `action(arg1, arg2, ...)`

同时，skill 需要提供正反例来约束模型生成逻辑体。例如：

- 正例：`如果 InventoryLot.availableQty 足以覆盖当前需求，则可用周期为 0。`
- 反例：`如果库存差不多够，就直接用。`

备选方案：
- 继续收紧为近似 DSL 的语法。未采用，因为会降低可读性和表达弹性。
- 完全放开为自由中文。未采用，因为难以约束一致性。

### 7. 前端 demo 采用三页式产品结构，而不是单页三栏工作台

前端 demo 将采用三个主要页面承载三类演示能力：

1. `本体数据导入与自动化建模`
2. `本体查看与管理`
3. `基于本体的 Agent 业务问答`

不采用单页三栏工作台的原因是，当前 demo 的叙事目标更偏“产品能力分区展示”，而不是高频操作台。三页结构更适合在演示时逐步讲清楚：

- 数据如何进入系统
- 本体如何被查看、编辑和组织
- Agent 如何基于本体回答业务问题

同时，这三个页面仍然共享同一套 domain 上下文和资源体系，避免 UI 分页后形成割裂系统。

备选方案：
- 单页三栏工作台。未采用，因为对首次演示用户的信息密度过高，且不利于按模块讲解。
- 完全独立的三套页面体系。未采用，因为会切断 domain、对象和能力上下文。

### 8. 本体查看与管理页作为前端 demo 的核心页面

在三页结构中，`本体查看与管理` 是当前阶段的重点页面。该页面需要完整承载以下资源视图：

- `Object` 列表与详情
- `Link` 列表与详情
- `Function` 列表与详情
- `Action` 列表与详情
- `能力发现图` 视图

页面组织建议为：

- 顶部：domain 选择、搜索、视图切换
- 左侧：资源树或资源列表，按 `Object / Link / Function / Action` 分组
- 中央：资源详情与编辑区
- 右侧：依赖关系、引用关系、受影响资源和逻辑体摘要

其中编辑重点不是做复杂图编辑器，而是：

- 修改元数据字段
- 修改能力边界
- 修改结构化自然语言逻辑体
- 查看对象与能力之间的依赖关系

这样可以用最低实现复杂度，突出本体系统“资源清晰、能力清晰、逻辑可审”的特点。

### 9. Agent 问答页采用“左对话、右上下文与推理链”的双栏结构

`基于本体的 Agent 业务问答` 页面建议采用：

- 左侧：对话区、示例问题、当前 domain 和当前问题状态
- 右侧：上下文与推理链

右侧至少展示：

- 问题分类
- 当前选中的 domain
- 锚定到的 `Object`
- 命中的 `Link`
- 匹配到的 `Function`
- 匹配到的 `Action`
- 查询路径或发现路径
- 最终报告摘要

这样可以保证 demo 不只是“问答结果”，而是能清楚展示 agent 如何基于 ontology 做问题分解、资源发现、能力匹配和报告生成。

### 10. 数据导入与自动化建模页只做界面占位和流程预告

`本体数据导入与自动化建模` 页面当前阶段不提供真实导入与建模能力，但也不应为空白页。它应当作为“接入台”存在，至少包含：

- 数据源接入入口区
- 上传区或数据源卡片区
- 自动建模结果预览区
- 当前阶段能力说明
- 一键加载样例 domain 或样例数据的入口

这一设计的目标不是演示真实建模能力，而是让前端信息架构完整，并为后续扩展预留稳定位置。

### 11. 三页之间共享 domain 上下文与当前资源选中状态

虽然采用三页结构，但前端仍需共享以下上下文：

- 当前选中的 domain
- 当前选中的 `Object / Link / Function / Action`
- 当前样例数据或样例问答
- 最近一次 agent 分析结果

这样用户可以在：

- 导入页加载某个样例 domain
- 管理页查看并修改其本体资源
- 问答页直接基于同一 domain 发起业务问题

前端演示才能形成一条连续链路，而不是三个互不相关的演示页面。

### 12. 前端 demo 先实现“可讲清楚”，再追求“完整可操作”

当前阶段的优先级是：

1. `本体查看与管理`
2. `Agent 业务问答`
3. `数据导入与自动化建模`

原因是 demo 的核心价值在于：

- 用户能看清本体资源的组织方式
- 用户能理解能力面如何围绕语义面组织
- 用户能看到 agent 的推理链和报告生成过程

因此前端设计应优先服务“可解释演示”，而不是优先做完整的数据接入或复杂编辑交互。

## Risks / Trade-offs

- [异构图依赖字段与实际逻辑体发生漂移] → 以 `functions.json`、`actions.json` 作为单一事实源，能力边只从元数据派生，不从逻辑体反推。
- [结构化中文逻辑体仍可能出现歧义] → 用显式引用规则和正反例约束生成，并在 review 时优先检查输入、依赖、条件和输出是否完整。
- [Object/Link 与 runtime/path template 的边界被再次混淆] → 在 skill 主入口文档中明确区分 ontology core 与 runtime helper，并要求问题处理先看 ontology，再看 runtime。
- [旧 domain pack 迁移成本增加] → 提供 manifest 和 schema 的迁移规则，先迁移主入口 skill 与一个代表性 domain，再推广到其他 domain。
- [前端三页结构导致上下文断裂] → 统一用 domain 级共享状态保存当前 domain、当前资源和最近一次问答结果，并在页面间持续透传。
- [本体管理页信息密度过高] → 采用“资源列表 + 详情编辑 + 依赖摘要”的布局，避免前期引入复杂图编辑器。

## Migration Plan

1. 调整 `ontology-platform` 的主入口文档，改用 `Object/Link + Function/Action + runtime` 的表述。
2. 修改 domain pack 目录结构，将原 `schema/` 拆分为 `ontology/` 与 `runtime/`。
3. 将原 `data-model.json` 拆分为 `objects.json` 与 `links.json`。
4. 为 `functions.json`、`actions.json` 增加能力边界和依赖声明字段。
5. 增加 `runtime/capability-graph.json`，并约定其为由 metadata 派生的发现图。
6. 更新逻辑层格式文档，加入更宽松但严谨的结构化中文规则与正反例。
7. 选取 `manufacture-design-change` 作为首个迁移验证 domain。
8. 为前端 demo 增加三页式信息架构设计，并围绕 `本体查看与管理` 与 `Agent 业务问答` 两页优先落地。

## Open Questions

- `capability-graph.json` 是否在 demo 阶段就生成落盘，还是先作为运行时内存结构存在。
- `Function -WRITES-> Object` 是否在当前阶段开放，还是继续仅允许 action 作为外部写入入口。
- 是否需要在后续引入 `Object Set` 作为稳定的业务集合资源，替代部分路径模板职责。
- 本体查看与管理页是否需要在第一版就支持图谱可视化编辑，还是先以列表、详情和依赖视图为主。
