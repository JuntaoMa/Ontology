## Why

当前 demo 已经形成了基于 `domain pack` 的本体问答入口，但本体层仍然沿用“数据模型层 + 能力元数据层 + 逻辑层”的表述，语义资源与能力资源的边界不够清晰，也缺少一套面向 agent 探索的统一发现结构。随着后续要接入更多业务 domain，需要先明确本体核心架构，避免不同 domain 在对象定义、能力定义、路径发现和逻辑表达上继续分化。

## What Changes

- 将 domain 的本体核心重构为两大资源面：
  - `语义面`：`Object`、`Link`
  - `能力面`：`Function`、`Action`
- 增加统一的异构发现图，用轻量依赖关系把语义资源与能力资源连接起来，支持 agent 从业务对象出发发现可用能力。
- 将查询入口和路径模板从本体核心中拆出，单独归入 `runtime/`，作为问答系统的查询辅助层。
- 将 function/action 的具体实现统一定义为“结构化自然语言逻辑体”，并补充严谨、无歧义的表达约束与示例。
- 为 demo 增加三页式前端演示结构，分别承载本体数据导入与自动化建模、本体查看与管理、基于本体的 Agent 业务问答。
- **BREAKING**：调整 domain pack 的目录结构和文件定位方式，由原 `schema/` 结构迁移为 `ontology/ + runtime/ + logic/`。
- **BREAKING**：将原 `data-model.json` 的点边定义拆分为 `objects.json` 与 `links.json`，并将 function/action 的能力依赖声明从零散字段收敛为统一元数据字段。

## Capabilities

### New Capabilities
- `ontology-semantic-resources`: 定义 domain 中 `Object` 与 `Link` 的最小语义资源模型、字段约束与组织方式。
- `ontology-capability-resources`: 定义 `Function` 与 `Action` 的元数据结构、能力边界、依赖声明与逻辑体定位方式。
- `ontology-capability-discovery`: 定义基于异构图的资源发现机制，以及 `runtime/` 中统一入口与路径模板的职责边界。
- `ontology-logic-expression`: 定义 function/action 的结构化自然语言逻辑体格式、引用规则和正反例约束。

### Modified Capabilities

## Impact

- 影响 `.codex/skills/ontology-platform/` 的主入口说明、domain 定位方式和参考文档。
- 影响现有 domain pack 的目录结构、manifest 字段和 schema 文件拆分方式。
- 影响后续业务 domain 的接入规范，以及 agent 在本体层做对象发现、能力发现和逻辑审查的方式。
- 影响前端 demo 的信息架构、页面导航方式和问答推理链展示形式。
