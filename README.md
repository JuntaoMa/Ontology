# Ontology — 本体探索项目集合

本仓库是多个**本体（Ontology）探索子项目**的集合。每个子项目相互独立、各自放在
单独的子文件夹中，仓库根目录只负责汇总与索引。

## 子项目

| 子文件夹 | 领域 | 简介 |
|----------|------|------|
| [`3GPP_Ontology/`](3GPP_Ontology/) | 通信网络 | 基于 3GPP Rel-19 的 5G SA + 4G EPC (CUPS) 网络拓扑本体（TBox/Schema），含 Cell / PDU Session / QoS Flow / DRB 会话层，双方向（用户面+控制面）质差传播模型，KPI/QoE 脚手架。OWL 2 Turtle，~1575 triples。 |
| [`SmartManufacturing/`](SmartManufacturing/) | 智能制造 | 制造设计变更 demo：本体平台（`.codex` skills、`openspec` 规范、`demo/` 前端、设计变更/废料成本走查文档）。 |

## 约定

- 每个子项目自带各自的 `README`、依赖与（如有）`.gitignore`；根目录不引入跨子项目的统一构建。
- 新增本体探索项目时，在根目录新建一个子文件夹，并在上表登记一行。

> `Ontology_1/`（旧目录中残留的 SHACL demo）不属于本仓库，由仓库维护者另行处理。
