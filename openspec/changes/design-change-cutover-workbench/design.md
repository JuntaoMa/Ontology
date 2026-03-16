## Context

当前实现已经完成了以下结构：

- 一个通用入口 skill：`.codex/skills/ontology-business-qa-entry/`
- 一个 domain 注册表：`domains/index.json`
- 一个通用样例 domain：`sample-generic`
- 一个真实业务 domain：`design-change-material-readiness`
- 一组根目录下的业务 agent 报告示例：
  - 第三批次切换新物料可用周期
  - 第三批次切换旧物料报废成本

这与最早设想的“单一 cutover 场景专用工作台”已经不同。当前实现已经形成了更清晰的三层：

1. `通用入口层`
   负责问题分类、domain 发现、统一入口和输出规范。
2. `domain pack 层`
   负责每个业务域的 schema 与 logic 资产。
3. `业务报告层`
   负责把已知流程问题或能力缺口问题整理成简洁的业务 agent 处理报告。

同时，当前实现也已经明确了两条关键方向：

- schema 只存元数据，不存逻辑体；
- logic 用结构化中文表达，并保持查询、函数、动作三层分离。

## Goals / Non-Goals

**Goals**
- 让 OpenSpec 准确描述当前已经落地的通用 skill + domain pack 架构。
- 固化 domain pack 的目录组织和加载规则。
- 固化 schema 与 logic 分层，以及结构化中文逻辑体规范。
- 固化 design-change-material-readiness 作为首个已落地 domain 的能力边界。
- 固化已知业务流程与能力缺口业务流程两种处理模式。
- 固化最终业务 agent 报告的精简输出格式。

**Non-Goals**
- 不把当前实现重新改回 QIR-first 的专用查询工作台设计。
- 不在本次规范中强制要求真实数据库连接或脚本化执行器。
- 不定义所有未来业务域的具体对象和函数集合。
- 不覆盖执行型外部写操作，例如锁批次、写回 MES 或执行真实设计变更。

## Decisions

### 1. 采用“通用入口 skill + domain pack”架构

当前实现不再为单一业务场景单独设计一个 skill，而是采用一个通用的 `ontology-business-qa-entry` 作为主入口。具体业务域通过 domain pack 接入。

每个 domain pack 统一放在：

```text
domains/<domain-id>/
├── manifest.json
├── schema/
└── logic/
```

这样做的原因：
- domain 可以独立演进和插拔；
- 通用入口不用携带具体业务细节；
- agent 可以先发现 domain，再按 manifest 加载最小必要上下文。

### 2. schema 与 logic 明确分层

每个 domain 的 schema 固定拆成：

- `data-model.json`
- `functions.json`
- `actions.json`
- `path-templates.json`

这些文件只表达元数据，不表达具体逻辑。

具体逻辑统一放在：

- `logic/functions/*.md`
- `logic/actions/*.md`

这样做的原因：
- 元数据稳定，逻辑可演进；
- function/action 的输入输出契约和逻辑体可以分别审阅；
- 能同时支持“已有能力调用”和“能力缺口草案生成”。

### 3. 统一入口以高层操作语义为中心，而不是以 Query IR 为中心

当前实现的主入口是以下统一操作语义：

- `discover_domains()`
- `get_domain_manifest(domain_id)`
- `get_data_model_detail(domain_id, model_id)`
- `get_capability_metadata(domain_id, capability_id)`
- `get_path_templates(domain_id, start_type, target_type_or_goal)`
- `query_instances_by_type(domain_id, node_type, filters)`
- `query_instances_by_path(domain_id, anchor_binding, path_template_id, filters)`
- `assess_problem_capability_fit(domain_id, problem_statement)`
- `draft_new_capability(domain_id, problem_statement)`

这意味着：
- 规范不再要求以 Query IR 作为主输出；
- 路径模板、实例查询和能力评估已经足以支撑当前 Demo；
- 若后续需要内部 IR，可以作为实现细节再补，而不是当前规范中心。

### 4. 逻辑体统一采用结构化中文表达

当前实现已经采用结构化中文来表达 function/action 逻辑，例如：

- `查询`
- `调用`
- `设`
- `如果`
- `否则`
- `对 … 中的每个 … 执行`
- `返回`
- `失败`

同时保留严格的本体对齐规则：
- 属性写成 `Class.property`
- 边写成 `Class -EDGE-> Class`
- 函数写成 `func(arg1, arg2, ...)`
- 动作写成 `action(arg1, arg2, ...)`

这样做的原因：
- 对 Demo 更易读；
- 能保持逻辑可审计；
- 仍然具备后续向机器可执行表示迁移的可能。

### 5. design-change-material-readiness 是首个已落地 domain

该 domain 目前覆盖两类业务问题：

1. 已知业务流程类问题
   - 第三批次切换时的新物料可用周期分析
   - 通过现有 action 和函数链直接处理

2. 能力缺口业务流程类问题
   - 第三批次切换时的旧物料报废成本分析
   - 通过现有查询能力定位事实
   - 通过 `draft_new_capability(...)` 生成缺失函数草案
   - 通过临时编排输出 review-ready 结果

这两个问题共同验证了当前实现路线：
- 已知流程可复用现有 action
- 能力缺口流程可显式暴露缺口并生成新 function/action 草案

### 6. 输出统一收敛为简洁业务 agent 报告

当前实现不再输出冗长的内部说明文档，而是把最终结果收敛为三段式业务 agent 报告：

- `分析结论`
- `问题判断`
- `逻辑流程`

其中 `逻辑流程` 只保留：
- 调用了什么工具
- 目的是什么
- 结果是什么

这样做的原因：
- 更适合 Demo 演示；
- 能保留可追溯性；
- 不会被底层实现细节淹没。

## Risks / Trade-offs

- [不再以 Query IR 为规范中心] -> 当前 Demo 可读性和一致性更好，但后续若做脚本化执行，需要再补内部表示规范。
- [结构化中文逻辑体不是机器执行语言] -> 当前阶段可读、可审优先，后续可以在不改元数据的前提下再补编译层。
- [能力缺口流程会引入临时编排] -> 需要在报告中显式区分“正式现有能力结果”和“review-ready provisional result”。
- [domain pack 会带来更多文件] -> 用 manifest 和注册表控制加载范围，避免入口 skill 失控。

## Migration Plan

1. 用通用入口 skill 替代旧的单场景 cutover 叙述。
2. 用 domain pack 组织方式替代外层统一 `assets/` / `logic/` 结构。
3. 用统一入口和路径模板替代 Query IR-first 的主规范。
4. 保留 design-change-material-readiness 作为首个真实 domain。
5. 用两份业务 agent 报告作为当前实现的验证样本。

## Open Questions

当前没有阻塞本次文档整理的开放问题。后续若要将结构化中文逻辑体编译成可执行流程，可通过新的 OpenSpec 变更单独定义逻辑 IR 和执行器。
