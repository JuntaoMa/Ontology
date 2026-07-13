# 校验器分类法重构 · Spec（20）

> 取代 V0..V5 编号心智模型。校验器是 DAG 节点，**按目的命名、按作用对象归类**。
> 上游讨论结论（用户 4 项拍板）：①多 scope 各组重复出现 ②intake 独立成句法入口
> ③真改 id ④真做选择性触发。本 spec 是实现锚点；旧 spec（00）的 AC 仍然有效，
> 只是 `validator_id` 与「层」表述按本 spec 迁移。

## 1. 三条正交轴（不再揉进一个 V 编号）

| 轴 | 字段 | 取值 | 作用 |
|---|---|---|---|
| 作用对象 | `scope: Set` | `{schema,instance,rule,process}` 子集 | 分组展示 + change-set 触发 |
| 归属类别 | `category` | `intake/schema/instance/rule/process/cross/meta` | id 命名空间 + 主展示组 |
| 权限 | `authority` | `veto/score/advise` | 否决力（不变） |
| 执行次序 | `depends_on` | DAG | 拓扑序（取代 V 编号的"次序"含义） |

权限叙事：**敢有多大权 = 背后规格有多显式可判定**。显式硬规则→veto；显式软约束→score；只有判断→advise。

## 2. id 映射（category.purpose）

| 旧 id | 新 id | category | scope | authority | 引擎 |
|---|---|---|---|---|---|
| v0.structure | `intake.structure` | intake | rule,process | veto | 结构断言 |
| v2.shacl_minimal | `instance.required-fields` | instance | instance | veto | SHACL minimal |
| v2.shacl_trusted | `instance.data-quality` | instance | instance | score | SHACL trusted |
| v1.consistency | `schema.consistency` | schema | schema | score | owlrl OWL-RL |
| v1.pitfalls | `schema.pitfalls` | schema | schema | score | 图模式扫描 |
| v1.cq | `instance.competency` | instance | schema,instance | score | SPARQL |
| v3.rules | `rule.defects` | rule | rule | score | Z3 SMT |
| v4.formal | `process.soundness` | process | process | score | Petri/pm4py |
| v4.simulation | `process.simulation` | process | process,rule | score | play-out+数据感知 |
| v4.cross | `cross.rule-process` | cross | rule,process | score | mini-Declare |
| v5.j1 | `schema.semantic` | schema | schema | advise | LLM judge |
| v5.j2 | `cross.faithfulness` | cross | rule,process | advise | LLM judge |
| v5.j3 | `meta.review` | meta | （findings） | advise | LLM judge |

`title`（界面用目的名）：结构完整性 / 必填底线 / 数据质量 / 逻辑一致性 / 建模坏味道 /
能力问题 / 规则集缺陷 / 流程健全性 / 数据感知仿真 / 规则×流程一致 / 语义合理性 /
抽取忠实性 / 复判收口。

## 3. 展示分组规则（决策①②）

显示组顺序与归属：
1. **句法入口**：`category==intake`（仅 structure；不再额外挂到规则/流程下）。
2. **本体 schema**：`schema ∈ scope`。
3. **实例 instance**：`instance ∈ scope`。
4. **规则 rule**：`rule ∈ scope`。
5. **流程 process**：`process ∈ scope`。
6. **复判 meta**：`category==meta`（仅 review，作用于 findings）。

多 scope 校验器在每个命中组**重复出现**（决策①）：
- `instance.competency`（schema,instance）→ 本体 + 实例；
- `process.simulation`（process,rule）→ 规则 + 流程；
- `cross.rule-process` / `cross.faithfulness`（rule,process）→ 规则 + 流程。

`cross.*` 没有独立"跨域"展示组（决策①选前者）；`cross` 仅作 id 命名空间，标记其落在
规则×流程边界。intake/meta 只进各自专属组、不按 scope 重复。

## 4. change-set 选择性触发（决策④）

`run_pipeline(..., change_set: set[str] | None)`：
- `change_set is None` → 全量（现状）。
- 否则：`triggered = {v : v.scope ∩ change_set ≠ ∅}`；`run_set = triggered` 的 DAG 下游闭包
  （`v` 依赖 run_set 任一成员则加入）。
- 不在 run_set 的校验器记 `verdict='scope_skip'`，**视作已满足依赖**（同 inapplicable），
  使下游被触发节点（如 `meta.review` 仅 instance 变更时仍能复判实例 findings）不被卡。

scope 是**制品类型级**触发：能做到"改实例就不跑流程校验器"，但"只重跑受影响的那一条
app"需对象级依赖追踪，超出本 demo（如实标注，不夸大为全量增量）。

API：`POST /api/runs?scope=instance` 或 `?scope=rule,process`（逗号分隔；缺省=全量）。
`GET /api/pipeline/scopes` 暴露可选场景。

下游闭包**只对纯聚合节点**（scope 为空，仅 `meta.review`）生效：任一输入被触发即纳入复判。
**不做全量下游闭包**——否则 `intake.structure`（scope 含 rule）被规则变更触发后，会把它下游的
`process.soundness` 等无关节点一并拉起（改规则不该重跑流程健全性）。每个校验器的 scope 已
诚实列出其读取的全部制品类型，故直接命中即可正确级联（`process.simulation` 读规则 guard、
scope 含 rule，改规则会直接触发它）。

验收：
- TX-1 `scope=instance` → 触发 `instance.required-fields/data-quality/competency` + `meta.review`；其余 scope_skip；
- TX-2 `scope=rule` → 触发 `intake.structure`+`rule.defects`+`process.simulation`+`cross.rule-process`+`cross.faithfulness`+`meta.review`；`process.soundness` 与 schema/instance-only 节点 scope_skip；
- TX-3 `scope=process` → 同 TX-2 但用 `process.soundness` 取代 `rule.defects`；
- TX-4 全量（change_set=None）与现状结果一致（回归不变）。

## 5. 变异矩阵泳道（保住确定性 vs LLM 对比）

矩阵列从 V0..V5 改为语义泳道，`lane(spec) = 'LLM' if authority=='advise' else fold(category)`，
`fold: intake→句法, schema→本体, instance→实例, rule→规则, process→流程, cross→流程`。
LANES = [句法, 本体, 实例, 规则, 流程, LLM]。各 op 的 expected 同步重映射
（V0→句法…V4→流程, V5→LLM），`as_expected = expected ⊆ captured` 逻辑不变。
