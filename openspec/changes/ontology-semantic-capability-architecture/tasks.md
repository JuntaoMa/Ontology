## 1. 主入口 Skill 重构

- [x] 1.1 更新 `ontology-platform/SKILL.md`，将核心架构改写为 `Object/Link + Function/Action + runtime`
- [x] 1.2 更新主入口参考文档，明确语义面、能力面、运行时辅助层的职责边界
- [x] 1.3 更新问题分流和统一入口文档，使输出显式区分 `Object`、`Link`、`Function`、`Action`

## 2. Domain Pack 目录迁移

- [x] 2.1 将 domain 目录结构从 `schema/ + logic/` 重构为 `ontology/ + runtime/ + logic/`
- [x] 2.2 更新 `domains/index.json` 与各 domain `manifest.json` 的文件定位方式
- [x] 2.3 为新结构补充示例 domain 或模板文件，确保后续 domain 接入可复用

## 3. 本体核心资源建模

- [x] 3.1 将现有 `data-model.json` 拆分为 `ontology/objects.json` 与 `ontology/links.json`
- [x] 3.2 调整 `ontology/functions.json` 与 `ontology/actions.json` 的最小元数据字段和能力边界字段
- [x] 3.3 为 function/action 增加对象、关系与能力依赖声明字段，用作能力发现的单一事实源

## 4. Runtime 与逻辑表达规范

- [x] 4.1 将统一入口和路径模板迁移到 `runtime/entrypoints.json` 与 `runtime/path-templates.json`
- [x] 4.2 定义 `runtime/capability-graph.json` 的结构和生成约定
- [x] 4.3 更新逻辑层规范文档，改为“严谨、无歧义的结构化自然语言”并补充正反例

## 5. 首个 Domain 迁移验证

- [x] 5.1 将 `manufacture-design-change` 迁移到新目录结构和新元数据规范
- [x] 5.2 对齐该 domain 的 function/action 逻辑体引用方式和依赖声明
- [x] 5.3 验证 agent 能从业务对象出发，通过异构发现结构定位相关 function/action 并生成正确的问题处理链路

## 6. 前端 Demo 信息架构

- [ ] 6.1 设计三页式前端 demo 结构：本体数据导入与自动化建模、本体查看与管理、基于本体的 Agent 业务问答
- [ ] 6.2 明确本体查看与管理页的资源视图、编辑区域和依赖关系展示方式
- [ ] 6.3 明确 Agent 问答页的对话区、上下文区、推理链区和报告区布局
- [ ] 6.4 设计三页之间共享的 domain 上下文、当前资源选中状态和最近一次问答结果
