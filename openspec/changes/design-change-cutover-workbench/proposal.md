## Why

当前 OpenSpec 文档仍把这次变更描述成“面向单一制造切换成本场景的专用工作台 + Query IR/Cypher 优先”的方案，但当前实现已经明显演进为另一种结构：

- 主体是一个通用的本体业务问答入口 skill：`ontology-business-qa-entry`
- 具体业务能力通过 `domain pack` 插拔接入
- 每个 domain 内部统一管理 `schema/` 和 `logic/`
- 查询、函数、动作分层保持不变，但统一入口已经从“QIR 主导”转为“domain 发现 + 元数据探索 + 查询路径模板 + 自然语言逻辑体”
- 当前首个已落地 domain 是 `design-change-material-readiness`
- 当前已经沉淀了两类业务 agent 报告示例：
  - 已知业务流程类问题：第三批次切换新物料可用周期
  - 能力缺口业务流程类问题：第三批次切换旧物料报废成本

如果不整理 OpenSpec，规范会继续和实现漂移，后续无论扩 domain 还是补 capability 都会缺少一致的基线。

## What Changes

- 将本次变更重新定义为“通用本体业务问答入口 skill + 首个设计变更 domain pack”的实现，而不是单一 cutover 专用工作台。
- 用 `domain pack` 作为组织单元，要求每个 domain 在同一目录下统一管理 `manifest.json`、`schema/` 和 `logic/`。
- 将 schema 明确拆分为四类资产：
  - `data-model.json`
  - `functions.json`
  - `actions.json`
  - `path-templates.json`
- 将 function/action 的具体逻辑从 schema 中分离，统一放到 `logic/functions/` 与 `logic/actions/`，并采用结构化中文逻辑体表达。
- 将统一入口收敛为 domain 发现、schema 详情、能力元数据、路径模板、实例查询、能力匹配和新能力草案生成等高层操作语义，不再把 Query IR 作为主规范中心。
- 保留 `design-change-material-readiness` 作为首个落地 domain，覆盖：
  - 已知业务流程：设计变更第三批次切换的新物料可用周期分析
  - 能力缺口流程：设计变更第三批次切换的旧物料报废成本分析
- 将业务 agent 输出收敛为简洁报告格式，只保留分析结论、问题判断和逻辑流程，便于 Demo 展示。

## Capabilities

### New Capabilities
- `ontology-business-qa-entry`: 定义通用本体业务问答入口 skill 的分流规则、domain 发现方式、统一入口和输出规范。
- `domain-query-runtime`: 定义 domain pack 的 schema 组织方式、路径模板、统一查询入口和证据绑定要求。
- `domain-business-functions`: 定义 function 元数据与逻辑体分离、结构化中文逻辑体规范，以及 design-change-material-readiness domain 的核心函数集合。
- `domain-business-actions`: 定义已知业务动作的编排要求，以及能力缺口场景下如何生成新 capability 草案并输出临时业务报告。

### Modified Capabilities
- 无

## Impact

- 影响 `.codex/skills/ontology-business-qa-entry/` 的规范基线，后续新增业务域将按 domain pack 方式接入。
- 影响设计变更 Demo 的讲法，重点从“单个 cutover 查询工具链”转为“通用入口 + design-change domain + 业务 agent 报告”。
- 影响函数与动作的表达方式，当前规范明确采用“schema 元数据 + 结构化中文逻辑体”的双层表达。
- 影响后续能力扩展方式，已知流程优先复用现有 action，能力缺口流程则通过 `draft_new_capability(...)` 生成 review-ready 草案，而不是隐式扩功能。
