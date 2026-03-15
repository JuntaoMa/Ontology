# 制造设计变更切换成本分析 Demo 设计

## 文档目的

本文给出一版可直接用于 Demo 的“制造设计变更切换成本分析”案例设计，重点关注：

- 本体数据的最小 schema
- 能力层 `FunctionSpec / ActionSpec` 的定界
- 基于伪造数据的 Agent 推理链路
- 最终可追溯、可展示的业务问答效果

本文不追求真实系统集成，也不要求规划执行落地。当前假设 Agent 具备稳定执行复杂推理链的能力，重点只放在：

- 本体如何组织业务知识
- Agent 如何基于本体完成解答
- 整条链路如何可解释、可追溯

## 一、业务场景

机械制造企业在进行设计变更后，需要决定从哪个在产批次开始切换到新零件版本，目标是在满足变更生效约束的前提下，最小化：

- 时间成本：等待新零件到货导致的停线或延迟
- 金钱成本：旧件报废、在制返工、新件采购、加急物流等

用户输入仅为设计变更内容，例如：

> 设计变更 ECN-204：零件 `P123-RevA` 替换为 `P456-RevB`，请输出从各个批次开始切换的成本报告，并推荐最佳切换批次。

系统输出应包括：

- 受影响批次
- 各候选切换批次的成本拆分
- 推荐切换批次
- 关键假设、约束与证据链

## 二、Demo 成功标准

只要满足以下四点，就认为这版 Demo 成立：

1. Agent 能把用户问题对齐到本体中的 `EngineeringChange`、`ProductionBatch`、`CostRule`、`ReportArtifact` 等概念。
2. Agent 能从本体能力层发现正确的 `FunctionSpec / ActionSpec` 链路，而不是直接拍脑袋回答。
3. 最终报告中的每一项结论都能追溯到：
   - 本体对象与关系
   - 模拟业务数据
   - 成本规则
   - 所调用的函数
4. UI 或日志中能展示“用户问题 -> 能力召回 -> 数据读取 -> 仿真计算 -> 报告生成”的完整链条。

## 三、本体层模块划分

### 1. 设计变更模块

负责表达“变更本身是什么”。

核心节点：

- `EngineeringChange`
- `Part`
- `PartRevision`
- `EffectivityRule`
- `CompatibilityRule`

核心关系：

- `REPLACES`
- `INTRODUCES`
- `HAS_EFFECTIVITY`
- `HAS_COMPATIBILITY`
- `APPLIES_TO_MODEL`

### 2. 产品结构模块

负责表达“变更影响哪些产品结构”。

核心节点：

- `ProductModel`
- `Assembly`
- `BOMNode`
- `PartUsage`

核心关系：

- `USED_IN`
- `BELONGS_TO`
- `PART_OF`

### 3. 生产执行模块

负责表达“当前哪些批次已到哪一步，哪些还能切，哪些会返工”。

核心节点：

- `ProductionLine`
- `ProductionBatch`
- `VehicleUnit`
- `Station`
- `WIPState`

核心关系：

- `RUNS_ON`
- `CONTAINS_UNIT`
- `CURRENT_AT`
- `HAS_WIP_STATE`
- `CONSUMES`

### 4. 供应与库存模块

负责表达“旧件还能用多久，新件什么时候能到”。

核心节点：

- `InventoryLot`
- `Warehouse`
- `PurchaseOrder`
- `Shipment`
- `Supplier`
- `SupplyArrival`

核心关系：

- `STOCKED_IN`
- `SUPPLIED_BY`
- `INBOUND_FOR`
- `ALLOCATED_TO`

### 5. 成本与策略模块

负责表达“成本怎么算，切换有哪些硬约束”。

核心节点：

- `CostRule`
- `DowntimeRate`
- `ScrapPolicy`
- `ReworkPolicy`
- `ChangeoverPolicy`

核心关系：

- `GOVERNS_SWITCH`
- `APPLIES_TO_CHANGE`
- `APPLIES_TO_LINE`
- `APPLIES_TO_BATCH`

### 6. 能力层模块

负责表达“系统有哪些可调用能力”。

核心节点：

- `FunctionSpec`
- `ActionSpec`
- `ReportArtifact`

核心关系：

- `READS_TYPE`
- `WRITES_TYPE`
- `PRODUCES`
- `CALLS`
- `APPLIES_TO`
- `GUARDED_BY`
- `IMPLEMENTED_BY`

## 四、本体最小 Schema

以下是这版 Demo 建议采用的最小 schema。

### 1. 核心对象类型

| 类型 | 作用 |
|---|---|
| `EngineeringChange` | 表达设计变更事件 |
| `PartRevision` | 表达具体零件版本 |
| `ProductModel` | 表达受影响车型/产品型号 |
| `BOMNode` | 表达零件在产品结构中的位置 |
| `ProductionBatch` | 表达在产批次 |
| `WIPState` | 表达批次当前工序状态 |
| `InventoryLot` | 表达旧件库存 |
| `SupplyArrival` | 表达新件到货时间与数量 |
| `CostRule` | 表达停线、报废、返工、采购等成本规则 |
| `FunctionSpec` | 表达分析、仿真、排序等能力 |
| `ActionSpec` | 表达生成报告等业务动作 |
| `ReportArtifact` | 表达输出物，如切换成本报告 |

### 2. 关键关系

| 关系 | 起点 -> 终点 | 含义 |
|---|---|---|
| `REPLACES` | `EngineeringChange -> PartRevision` | 指定被替换旧件 |
| `INTRODUCES` | `EngineeringChange -> PartRevision` | 指定引入新件 |
| `APPLIES_TO_MODEL` | `EngineeringChange -> ProductModel` | 指定影响产品型号 |
| `USED_IN` | `PartRevision -> BOMNode` | 指定零件用于哪个 BOM 节点 |
| `BELONGS_TO` | `BOMNode -> ProductModel` | 指定 BOM 节点属于哪个型号 |
| `CONSUMES` | `ProductionBatch -> PartRevision` | 指定批次当前消耗的零件版本 |
| `HAS_WIP_STATE` | `ProductionBatch -> WIPState` | 指定批次当前状态 |
| `INBOUND_FOR` | `SupplyArrival -> PartRevision` | 指定新件到货信息 |
| `GOVERNS_SWITCH` | `CostRule -> EngineeringChange/ProductionBatch` | 指定规则约束范围 |
| `READS_TYPE` | `FunctionSpec -> ObjectType` | 指定函数读取哪些类型 |
| `PRODUCES` | `FunctionSpec/ActionSpec -> ReportArtifact/ObjectType` | 指定产出 |
| `CALLS` | `ActionSpec -> FunctionSpec` | 指定动作调用哪些函数 |

### 3. Neo4j 未来落库建议

当前不要求真的建库，但为了后续可迁移，schema 可以按 Neo4j 的思路设计：

- 节点 Label：
  - `EngineeringChange`
  - `PartRevision`
  - `ProductModel`
  - `BOMNode`
  - `ProductionBatch`
  - `WIPState`
  - `InventoryLot`
  - `SupplyArrival`
  - `CostRule`
  - `FunctionSpec`
  - `ActionSpec`
  - `ReportArtifact`
- 关系 Type：
  - `REPLACES`
  - `INTRODUCES`
  - `APPLIES_TO_MODEL`
  - `USED_IN`
  - `BELONGS_TO`
  - `CONSUMES`
  - `HAS_WIP_STATE`
  - `INBOUND_FOR`
  - `GOVERNS_SWITCH`
  - `READS_TYPE`
  - `PRODUCES`
  - `CALLS`

当前重点不是物理存储，而是先把节点和边的语义定稳。

## 五、能力层 Function / Action 定界

### 1. 设计原则

当前这版 Demo 中：

- `FunctionSpec` 负责分析、查询、仿真、排序
- `ActionSpec` 负责组织一次完整的业务处理过程并产出结果

约束如下：

- `FunctionSpec` 尽量无副作用
- `ActionSpec` 允许编排多个函数，但在本 Demo 中不做真实业务写入
- 本 Demo 的最终目标是生成 `CutoverCostReport`，因此最小动作只需要覆盖“生成报告”

### 2. 最小 FunctionSpec 集

#### `resolve_change_scope`

- 类型：`query`
- 作用：根据设计变更找到受影响产品型号与 BOM 路径
- 输入：`EngineeringChange`
- 输出：`AffectedScope`

#### `resolve_impacted_batches`

- 类型：`query`
- 作用：根据变更范围找到受影响在产批次
- 输入：`EngineeringChange`, `AffectedScope`
- 输出：`ImpactedBatchSet`

#### `generate_candidate_cutover_points`

- 类型：`rule`
- 作用：根据策略和批次状态生成候选切换批次
- 输入：`ImpactedBatchSet`, `ChangeoverPolicy`
- 输出：`CandidateCutoverSet`

#### `snapshot_supply_state`

- 类型：`query`
- 作用：读取旧件库存和新件到货状态
- 输入：`EngineeringChange`
- 输出：`SupplySnapshot`

#### `simulate_cutover_cost`

- 类型：`simulation`
- 作用：对单个候选切换点计算等待、报废、返工、采购成本
- 输入：`EngineeringChange`, `ProductionBatch`, `SupplySnapshot`, `CostRule`
- 输出：`CostBreakdown`

#### `rank_cutover_options`

- 类型：`ranking`
- 作用：对所有候选切换点按总成本与风险排序
- 输入：`CandidateCutoverSet`, `CostBreakdown[]`
- 输出：`RankedCutoverOptions`

#### `build_cutover_cost_report`

- 类型：`transform`
- 作用：将排序结果、证据链和假设汇总为最终报告
- 输入：`RankedCutoverOptions`, `EvidenceBundle`
- 输出：`CutoverCostReport`

### 3. 最小 ActionSpec 集

#### `create_cutover_cost_analysis`

- 类型：`analysis`
- 输入：`EngineeringChange`
- 调用：
  - `resolve_change_scope`
  - `resolve_impacted_batches`
  - `generate_candidate_cutover_points`
  - `snapshot_supply_state`
  - `simulate_cutover_cost`
  - `rank_cutover_options`
  - `build_cutover_cost_report`
- 输出：`CutoverCostReport`
- 副作用：无

对于最小 Demo，保留这一个 `ActionSpec` 就足够。

## 六、最小模拟数据

### 1. 设计变更

```yaml
EngineeringChange:
  id: ECN-204
  title: 制动支架零件替换
  old_part_revision: P123-RevA
  new_part_revision: P456-RevB
  applies_to_model: Model-X
  effectivity_rule: 必须在批次 B105 之前完成切换
  compatibility_rule: 旧件与新件不可混装于同一单车
```

### 2. 产品结构

```yaml
ProductModel:
  id: Model-X

BOMNode:
  id: BOM-Bracket-FrontBrake
  product_model: Model-X
  used_part: P123-RevA
```

### 3. 在产批次

```yaml
ProductionBatches:
  - id: B102
    model: Model-X
    quantity: 60
    current_station: S20
    change_related_station: S30
    wip_state: 已上线，尚未安装变更零件
  - id: B103
    model: Model-X
    quantity: 60
    current_station: S10
    change_related_station: S30
    wip_state: 已排产，未到关键工位
  - id: B104
    model: Model-X
    quantity: 60
    current_station: NotStarted
    change_related_station: S30
    wip_state: 次日计划开工
  - id: B105
    model: Model-X
    quantity: 60
    current_station: NotStarted
    change_related_station: S30
    wip_state: 不允许再使用旧件
```

### 4. 供应状态

```yaml
InventoryLot:
  part_revision: P123-RevA
  available_qty: 140

SupplyArrival:
  part_revision: P456-RevB
  eta: 2026-03-18T08:00:00
  available_qty: 240
```

### 5. 成本规则

```yaml
CostRules:
  downtime_cost_per_hour: 30000
  scrap_cost_per_old_part: 200
  rework_cost_per_vehicle: 800
  expedite_cost_flat: 8000
  candidate_objective: total_cost_min
```

### 6. 人工假设

为了让 Demo 成立，可以显式声明以下假设：

- 每个批次需要 60 个该零件
- B102 尚未到安装工位，因此无需返工
- B103、B104 在新件到货前可灵活调整开工顺序
- B105 由 effectivity rule 明确限制，不能作为旧件继续消耗的批次

## 七、Agent 推理链路模拟

### 1. 用户输入

```text
ECN-204：零件 P123-RevA 替换为 P456-RevB，请输出从各个批次开始切换的成本报告，并推荐最佳切换批次。
```

### 2. 语义解析

Agent 生成：

```yaml
BusinessIntent:
  goal: generate_cutover_cost_report
  change_id: ECN-204
  target_output: CutoverCostReport
  optimize_for: total_cost
  domain: manufacturing_changeover
```

### 3. 本体对齐

命中的关键对象：

- `EngineeringChange`
- `PartRevision`
- `ProductionBatch`
- `SupplyArrival`
- `CostRule`
- `CutoverCostReport`

命中的关键能力：

- `create_cutover_cost_analysis`
- `resolve_change_scope`
- `resolve_impacted_batches`
- `generate_candidate_cutover_points`
- `snapshot_supply_state`
- `simulate_cutover_cost`
- `rank_cutover_options`
- `build_cutover_cost_report`

### 4. 数据读取与中间结果

#### `resolve_change_scope`

输出：

```yaml
AffectedScope:
  product_model: Model-X
  bom_node: BOM-Bracket-FrontBrake
  old_part_revision: P123-RevA
  new_part_revision: P456-RevB
```

#### `resolve_impacted_batches`

输出：

```yaml
ImpactedBatchSet:
  batches: [B102, B103, B104, B105]
```

#### `generate_candidate_cutover_points`

输出：

```yaml
CandidateCutoverSet:
  candidates:
    - B102
    - B103
    - B104
  excluded:
    - batch: B105
      reason: 必须在 B105 前完成切换
```

#### `snapshot_supply_state`

输出：

```yaml
SupplySnapshot:
  old_part_available_qty: 140
  new_part_eta: 2026-03-18T08:00:00
  new_part_available_qty: 240
```

### 5. 仿真计算

#### `simulate_cutover_cost(B102)`

```yaml
CostBreakdown:
  start_batch: B102
  wait_hours: 18
  wait_cost: 540000
  scrap_cost: 4000
  rework_cost: 0
  expedite_cost: 8000
  total_cost: 552000
  notes:
    - 新件到货前需要等待
    - 旧件尾料存在少量报废
```

#### `simulate_cutover_cost(B103)`

```yaml
CostBreakdown:
  start_batch: B103
  wait_hours: 6
  wait_cost: 180000
  scrap_cost: 4000
  rework_cost: 0
  expedite_cost: 8000
  total_cost: 192000
  notes:
    - 旧件可覆盖 B102
    - B103 需要短时等待新件到货
```

#### `simulate_cutover_cost(B104)`

```yaml
CostBreakdown:
  start_batch: B104
  wait_hours: 0
  wait_cost: 0
  scrap_cost: 4000
  rework_cost: 0
  expedite_cost: 0
  total_cost: 4000
  notes:
    - 旧件可覆盖 B102 与 B103
    - 新件在 B104 开工前到货
```

### 6. 排序与报告生成

#### `rank_cutover_options`

输出：

```yaml
RankedCutoverOptions:
  - start_batch: B104
    total_cost: 4000
    rank: 1
  - start_batch: B103
    total_cost: 192000
    rank: 2
  - start_batch: B102
    total_cost: 552000
    rank: 3
```

#### `build_cutover_cost_report`

输出：

```yaml
CutoverCostReport:
  change_id: ECN-204
  recommended_cutover_batch: B104
  summary: 在满足 B105 前切换约束下，从 B104 开始切换总成本最低
  options:
    - batch: B102
      total_cost: 552000
    - batch: B103
      total_cost: 192000
    - batch: B104
      total_cost: 4000
  assumptions:
    - 每批次需求 60 件
    - B102 未到安装工位
    - 新件到货时间可信
```

## 八、最终展示效果

### 1. 用户可见回答

```text
已完成 ECN-204 的切换成本分析。

受影响批次：B102、B103、B104。
由于变更策略要求必须在 B105 前完成切换，B105 不纳入候选切换点。

推荐切换批次：B104。

成本对比：
- 从 B102 开始切换：552,000 RMB
- 从 B103 开始切换：192,000 RMB
- 从 B104 开始切换：4,000 RMB

推荐原因：
- 旧件库存可覆盖 B102 和 B103
- 新件可在 B104 开工前到货
- 无停线等待
- 仅存在少量旧件尾料报废
```

### 2. 可追溯展示

UI 或调试视图中建议展示四类信息：

- 本体命中
  - `EngineeringChange: ECN-204`
  - `PartRevision: P123-RevA / P456-RevB`
  - `ProductionBatch: B102/B103/B104`
  - `CostRule`
- 能力调用链
  - `create_cutover_cost_analysis`
  - `resolve_change_scope`
  - `resolve_impacted_batches`
  - `generate_candidate_cutover_points`
  - `snapshot_supply_state`
  - `simulate_cutover_cost`
  - `rank_cutover_options`
  - `build_cutover_cost_report`
- 数据证据
  - 旧件库存数量
  - 新件 ETA
  - B105 前切换策略
  - 每批次需求量
- 结论映射
  - 推荐 B104 的原因直接映射到库存、到货和成本规则

## 九、最小版本定义

如果只做一个最小版本，请严格收缩到以下内容：

### 1. 最小对象集

- `EngineeringChange`
- `PartRevision`
- `ProductModel`
- `ProductionBatch`
- `SupplyArrival`
- `InventoryLot`
- `CostRule`
- `FunctionSpec`
- `ActionSpec`
- `ReportArtifact`

### 2. 最小能力集

- `resolve_change_scope`
- `resolve_impacted_batches`
- `generate_candidate_cutover_points`
- `snapshot_supply_state`
- `simulate_cutover_cost`
- `rank_cutover_options`
- `build_cutover_cost_report`
- `create_cutover_cost_analysis`

### 3. 最小页面或展示结构

- 左侧：用户问题、BusinessIntent、假设
- 中间：命中的本体对象、函数链、证据
- 右侧：批次成本对比、推荐结果、可追溯原因

### 4. 最小结论链

```text
用户问题
→ EngineeringChange 对齐
→ 批次与供应状态定位
→ 候选切换点生成
→ 成本仿真
→ 排序
→ 生成报告
→ 展示证据链
```

## 十、这版 Demo 的价值

这版设计能证明三件事：

1. 本体不仅能描述对象和关系，还能挂接能力层 `FunctionSpec / ActionSpec`。
2. Agent 回答业务问题不是直接自由生成，而是先完成本体对齐，再走能力调用链。
3. 最终回答可追溯到本体 schema、模拟数据、规则和函数结果，适合做技术演示和后续系统设计基线。
