# 本体校验系统设计图谱

## 文件角色

- `index.html`：对外展示入口，不包含校验器硬编码。
- `ontology-validator-registry.json`：页面唯一运行时数据源，也是后续整体设计的校验器注册表。
- `ontology-validator-registry.schema.json`：注册表结构约束。
- `app.js`：读取、校验、筛选和渲染注册表。
- `styles.css`：展示样式与响应式/打印布局。

## 注册表约定

注册表同时定义三层设计：

- `designElements` / `scopes`：原子校验器契约与作用域词表。
- `relationTypes`：前置依赖、数据供给、硬门禁、诊断解释、条件依赖和升级复核的边语义。
- `orchestration`：实施时的 DAG 阶段、模块节点、真实校验器引用、运行策略和失败路由。

页面中的校验器剖面图、关系图、DAG 和章节节点都从这些对象渲染。覆盖链路只表达检查范围，不能被当作固定执行顺序。

每个 validator 对象必须包含：

- `id`：全局稳定 ID，格式为 `chapter.code`。
- `code`：章节内展示编号。
- `label` / `term`：中文名称及可选英文术语。
- `criterion`：核心判据。
- `method`：可行实现方法。
- `authority`：节点主颜色，只能是 `veto/score/advise/human`。
- `authorityPlan`：完整权限流，例如 `V/S→H`。
- `cost`：`low/medium/high/research`。
- `core`：是否进入默认核心视图。
- `scope`：可选的节点级作用域；省略时继承所在 chapter 的默认 `scope`。

每个 chapter 必须声明默认 `scope`。作用域描述的是结论成立的边界，例如单个本体模块、imports 闭包、实例图、任务集、运行态或候选发布包，不能只作为展示标签使用。

## DAG 编排约定

- `orchestration.phases[].nodes[]` 是可调度模块，`validatorRefs` 必须引用真实 validator ID。
- `dependsOn` 是强依赖；`conditionalOn` 只在 manifest 声明对应制品或能力时激活。
- 注册表加载时检查未知引用、自依赖和环。发现环路即拒绝展示，也应拒绝进入实际编排器。
- 实际调度应使用不可变运行上下文和拓扑就绪条件；修复后的重跑创建新 run，不在 DAG 中回连形成环。
- 硬失败只阻断依赖后继，不应抹掉已完成的独立分支；`unknown/error` 不得转写为 `pass`。
- 每个节点输出统一 finding envelope，并以节点版本、输入哈希、配置和依赖输出哈希构成缓存键。
- 人工批准是显式 DAG 节点，批准、驳回、豁免和风险接受都必须绑定证据并进入发布审计。

注册表不保存“已实现/未实现”状态。实现跟踪属于工程计划，不应混入稳定的系统设计分类。

## 本地预览

在本目录运行：

```bash
UV_CACHE_DIR=../../../../.uv-cache \
  uv run --project ../../backend python -m http.server 8765
```

然后访问 `http://127.0.0.1:8765/`。页面需要通过 HTTP 读取同目录 JSON，不建议直接用 `file://` 打开。
