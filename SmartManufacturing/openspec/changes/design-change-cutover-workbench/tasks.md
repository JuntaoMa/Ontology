## 1. 通用入口 Skill

- [x] 1.1 在 `.codex/skills/` 下创建 `ontology-platform` 通用入口 skill
- [x] 1.2 编写 `SKILL.md`，定义问题分类、domain 发现、统一入口和输出规范
- [x] 1.3 生成或编写 `agents/openai.yaml`，补齐界面元数据

## 2. Domain Pack 机制

- [x] 2.1 定义 `domains/index.json` 和 `domains/<domain-id>/manifest.json` 的组织方式
- [x] 2.2 将每个 domain 的 `schema/` 与 `logic/` 放到同一目录下统一管理
- [x] 2.3 提供 `sample-generic` 作为业务无关的样例 domain

## 3. 设计变更 Domain

- [x] 3.1 创建 `manufacture-design-change` domain，并补齐 `data-model.json`、`functions.json`、`actions.json`、`path-templates.json`
- [x] 3.2 为 manufacture-design-change 补齐核心 function 逻辑体和已知业务 action 逻辑体
- [x] 3.3 在数据模型中覆盖旧件处置意见、旧件制造件映射和库存事实，为报废成本场景预留查询基础

## 4. 报告与示例

- [x] 4.1 构造 manufacture-design-change 的样例实例数据
- [x] 4.2 输出“第三批次切换新物料可用周期”的业务 agent 报告
- [x] 4.3 输出“第三批次切换旧物料报废成本”的业务 agent 报告，并显式展示能力缺口与新增 capability 草案

## 5. 文档收口

- [x] 5.1 校验 skill 目录结构、frontmatter 和 schema JSON 的基本合法性
- [x] 5.2 将 OpenSpec 文档重整为“通用入口 skill + domain pack + 结构化中文逻辑体”的实现思路
- [x] 5.3 确认当前变更已完成，可作为后续扩 domain 或归档前的稳定基线
