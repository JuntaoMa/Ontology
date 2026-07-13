# Ontology — 本体探索项目集合

本仓库统一管理本体（Ontology）案例、可视化组件和校验系统。领域案例保持独立，
通用应用放在 `apps/`，可复用组件放在 `packages/`，前端依赖由根级 pnpm 工作区管理。

## 子项目

| 子文件夹 | 领域 | 简介 |
|----------|------|------|
| [`3GPP_Ontology/`](3GPP_Ontology/) | 通信网络 | 基于 3GPP Rel-19 的 5G SA + 4G EPC (CUPS) 网络拓扑本体（TBox/Schema），含 Cell / PDU Session / QoS Flow / DRB 会话层，双方向（用户面+控制面）质差传播模型，KPI/QoE 脚手架。OWL 2 Turtle，~1575 triples。 |
| [`SmartManufacturing/`](SmartManufacturing/) | 智能制造 | 制造设计变更 demo：本体平台（`.codex` skills、`openspec` 规范、`demo/` 前端、设计变更/废料成本走查文档）。 |
| [`apps/ontology-viz/`](apps/ontology-viz/) | 本体可视化 | 基于 `@ontology/viz` 的通用 OWL/RDF 图谱浏览应用，内置 NPD 示例。 |
| [`apps/ontology-validation/`](apps/ontology-validation/) | 本体校验 | 本体、实例、规则和流程的混合校验工作台，包含 registry、DAG、确定性引擎、LLM judge 与人工写入闸门。 |

## 约定

- 前端应用和组件使用 pnpm workspace；Python 校验后端使用应用内 `pyproject.toml` 和 uv 环境。
- 根级默认 `dev/build/typecheck` 仍指向 ontology-viz；校验应用使用带 `:validation` 后缀的脚本。
- 新增本体探索项目时，在根目录新建一个子文件夹，并在上表登记一行。
- 结构化数据自动建模测试集记录在 [`docs/structured-data-ontology-testsets.md`](docs/structured-data-ontology-testsets.md)。

> `Ontology_1/`（旧目录中残留的 SHACL demo）不属于本仓库，由仓库维护者另行处理。
