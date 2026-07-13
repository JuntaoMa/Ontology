# Ontology Validation

本项目包含两个必须区分的层次：

1. **目标系统设计**：面向本体持续校验、任务验收和发布治理的完整设计图谱。它按 13 个章节组织
   196 个原子校验项，以 11 类作用域、四级权限和 6 阶段模块 DAG 描述目标能力。
2. **可运行参考实现**：以 loan / pizza fixture 验证混合校验思路的 Demo。确定性引擎负责形式判定，
   LLM judge 负责语义判定与复判，人工在写入闸门终审。

目标架构不再使用 V0–V6 作为系统分类法；校验项按稳定目的 ID 命名，执行次序只由 DAG 表达。
V0–V6 仅保留在旧实现材料中，作为历史设计和 Demo 讲解编号。

## 文档入口与状态

| 文档 | 角色 | 状态 |
|---|---|---|
| [`docs/system-design/index.html`](docs/system-design/index.html) | 新目标系统设计的可视化入口 | **当前设计基线** |
| [`docs/system-design/ontology-validator-registry.json`](docs/system-design/ontology-validator-registry.json) | 196 个原子校验项、关系与目标编排 DAG 的唯一数据源 | **当前设计基线** |
| [`docs/system-design/README.md`](docs/system-design/README.md) | 注册表、作用域、权限和 DAG 语义 | **先读** |
| [`specs/runtime-design-map.json`](specs/runtime-design-map.json) | 当前 runtime validator 到目标设计项的工程追踪 | 持续更新 |
| [`docs/overview.md`](docs/overview.md) | loan Demo 的实现导览 | 已实现参考 |
| [`docs/design-plan.md`](docs/design-plan.md) | 旧 V0–V6 Demo 的设计决策记录 | 历史基线 |
| [`specs/00-master-spec.md`](specs/00-master-spec.md) | 当前 Demo 的功能验收 | 已实现参考 |
| [`specs/20-validator-taxonomy-spec.md`](specs/20-validator-taxonomy-spec.md) | 当前 runtime 从旧 ID 迁移到目的 ID 的过渡规格 | 已实现桥接 |

当前 runtime 有 13 个 validator，映射到目标注册表中的 35 个设计项；目标模块 DAG 引用了 71 个
原子校验项。映射表示职责追踪，不表示 196 个设计项已经实现。

## 目标设计预览

```bash
cd apps/ontology-validation/docs/system-design
UV_CACHE_DIR=../../../../.uv-cache \
  uv run --project ../../backend python -m http.server 8765
```

打开 `http://127.0.0.1:8765/`。页面以注册表 JSON 为唯一数据源，可查看校验器剖面、作用域、关系和
目标 DAG。

## 参考 Demo

当前 Web 应用是目标设计的验证性子集，不代表目标系统的全部覆盖面。它重点验证本体 / 实例 / 规则 /
流程的混合裁判、findings 收件箱、quarantine、错误注入和人工终审。

前端为**亮色企业风 + 左侧栏 + 统一 findings 收件箱**（Tailwind v4 + 手写 shadcn 风格原语 +
Cytoscape + ECharts）。核心设计约束:**双语义轴分通道**——严重度用填充色、权限(veto/score/advise)
用图标+边框，永不抢同一视觉通道（常驻图例）。

## 快速开始

```bash
# 从 Ontology 仓库根目录安装前端工作区并构建
pnpm install
pnpm --filter ontology-validation-app build

# 后端（Python 3.12，始终由 uv 管理）
uv sync --project apps/ontology-validation/backend
uv run --project apps/ontology-validation/backend pytest
pnpm serve:validation
```

打开 `http://localhost:8000`，选择 fixture（loan / pizza）后运行全管线。开发前端可使用
`pnpm dev:validation`，Vite 默认把 `/api` 代理到 `http://localhost:8000`。

运行时数据库默认写入 `apps/ontology-validation/var/validation.db`。可通过
`ONTOLOGY_VALIDATION_DB`、`ONTOLOGY_VALIDATION_FIXTURES`、
`ONTOLOGY_VALIDATION_CASSETTES` 和 `ONTOLOGY_VALIDATION_FRONTEND_DIST` 覆盖路径。

## LLM judge 三种运行模式（自动选择）

| 模式 | 条件 | 说明 |
|---|---|---|
| CLI（默认） | 本机 `claude` 已登录 | 走 Claude Code 订阅，零 API 费用 |
| API | 设置 `ANTHROPIC_API_KEY` | anthropic SDK，适合服务化 |
| cassette 回放 | 两者皆无 | 复用 `cassettes/loan.json` 的已录制响应，**离线全流程可跑** |

重录 cassette：`uv run --project apps/ontology-validation/backend python apps/ontology-validation/backend/scripts/record_cassettes.py loan`
（含 gold 自检：O9/R11/P-edge 三个「仅 LLM 可抓」缺陷必须被真实 judge 命中）；
变异算子的 judge 响应：`scripts/record_mutation_cassettes.py`。

## 看什么（参考 Demo 剧本）

1. **总览仪表盘**：registry+DAG 执行表（veto/score/advise 三级权限徽章）、
   quarantine 数、**人工成本节约卡**（cassette 定格的真实复判：折叠 6/30 条省 20%；
   多次实录在 20–38% 区间，取决于 judge 当轮的保守程度）。
2. **本体校验**：O1 缺必填进 quarantine（veto)；O2–O7 SHACL/推理违例（score）；
   O9「临时雇员⊑材料文档」逻辑自洽、确定性层全 miss，**只有 J1 语义 judge 抓到**（紫色高亮）。
3. **规则校验**：R2×R4 冲突给出 Z3 具体反例；R5 dead rule；R8×R9 是「竞争建议」而非冲突
   （tier 分级语义）；J2 抓到 R11 数量级抽错（5000 vs 原文「五万」）——
   真实 judge 还顺带抓到了 R5 的根因（「或」抽成「且」）与 R8/R12 的「含本数」边界语义。
4. **流程校验**：deadlock 变体被 soundness 抓；dead_branch 演示控制流可达 vs 数据不可达的差异；
   rule_violation 变体被**规则×流程交叉验证环**抓住并回链 R10 原文；
   edge_unfaithful 结构完全健全，只有 J2 发现边方向与原文相反。
5. **错误注入实验室**：13 个变异算子 → 捕获率矩阵三类格局——确定性层抓形式缺陷、
   **仅 V5 列亮的语义/忠实性缺陷**、以及「删 disjoint」整行漏报（故意保留的管线盲区，
   演示矩阵作为可证伪质量证书）。
6. **审核队列（V6 写入闸门）**：按类型聚合打包审、judge 徽章与修复建议
   （accept_repair 记入 review_actions）、quarantine 可恢复、可信图谱导出
   （仅含通过闸门的对象）。

## 信息架构（左侧栏）

总览 / **收件箱(findings)** / 本体 / 规则 / 流程 / 错误注入 / 写入闸门。
findings 的逐条 triage 统一在**收件箱**完成(Sentry 式:按类型/对象/层分组、severity 筛选、
judge 高置信项默认折叠、详情抽屉看 judge 复判与修复建议、accept/dismiss/accept_repair 落库);
**写入闸门**只管 quarantine 恢复与可信图谱导出。

## 参考实现与旧设计记录的两处偏差

- 流程图用 **cytoscape 渲染 IR**（而非 bpmn-js）：pm4py 生成的 BPMN XML 缺布局 DI 时
  bpmn-js 无法渲染，方案文档已列 fallback；IR 直渲更稳且能标注数据不可达活动。
- 前端用 **Tailwind v4 + 手写 shadcn 风格原语**（cva + Radix），不跑 shadcn CLI——
  离线可复现，与 cassette 哲学一致；不引 antd。

## 实施中验证过的关键技术结论

- pySHACL `inference` 必须显式指定，且**本 demo 用 `none`**：RDFS range 推理会把
  错误引用的对象「推成」正确类型，反而掩盖 sh:class 违例（AC-O5 教训，
  与 TP §2.5.3「显式声明」原则同源）。
- owlrl 对 disjoint 违例通过 `agent-ont#error` 三元组报告；demo 用自写 disjoint
  扫描（结构化 locus）+ error 三元组兜底双保险。
- Z3 在同进程全局 context 下反例 model 跨运行可变：judge 输入必须过滤
  solver 衍生样例，否则缓存键漂移（`j3_review._VOLATILE_LOCUS`）；
  环检测等图遍历产物需规范化（最小节点起始）。
- rdflib 对「全常量三元组模式 + 未用 SELECT 变量」返回 0 行：CQ 写法须绑定变量。
- **cassette 可复现性三连修**：j1 条目排序（rdflib 集合遍历跨进程不稳）、
  环报告规范化（最小节点起始）、findings 入库前稳定排序（行 id 进 j3 输入）——
  离线回放已用三个不同 PYTHONHASHSEED 验证稳定命中。
