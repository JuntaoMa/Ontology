# 知识校验系统 Demo

业务场景下本体 / 规则 / 流程的混合校验工作台：**确定性引擎做形式判定（veto/score），
LLM judge 做语义判定与复判（advise），人工在写入闸门终审**。
设计文档：`../docs/validation-demo-plan.md`（v2.1）；验收规格：`specs/00-master-spec.md`。

## 快速开始

```bash
# 后端（Python 3.12，uv）
cd validation_demo/backend
uv venv --python 3.12 && uv sync
.venv/bin/python -m pytest          # 53 项验收测试（AC-* 全覆盖）
.venv/bin/python -m uvicorn app.main:app --port 8000

# 前端（构建产物由后端静态托管，访问 http://localhost:8000）
cd ../frontend && npm install && npm run build
```

打开页面 → 选择数据集（loan / pizza）→「运行全管线」。

## LLM judge 三种运行模式（自动选择）

| 模式 | 条件 | 说明 |
|---|---|---|
| CLI（默认） | 本机 `claude` 已登录 | 走 Claude Code 订阅，零 API 费用 |
| API | 设置 `ANTHROPIC_API_KEY` | anthropic SDK，适合服务化 |
| cassette 回放 | 两者皆无 | 复用 `cassettes/loan.json` 的已录制响应，**离线全流程可跑** |

重录 cassette：`backend/.venv/bin/python scripts/record_cassettes.py loan`
（含 gold 自检：O9/R11/P-edge 三个「仅 LLM 可抓」缺陷必须被真实 judge 命中）；
变异算子的 judge 响应：`scripts/record_mutation_cassettes.py`。

## 看什么（demo 剧本）

1. **总览仪表盘**：registry+DAG 执行表（veto/score/advise 三级权限徽章）、
   quarantine 数、**人工成本节约卡**（真实录制：judge 复判折叠 10/29 条，省 34.5%）。
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

## 与设计文档的两处实现偏差

- 流程图用 **cytoscape 渲染 IR**（而非 bpmn-js）：pm4py 生成的 BPMN XML 缺布局 DI 时
  bpmn-js 无法渲染，方案文档已列 fallback；IR 直渲更稳且能标注数据不可达活动。
- 前端未引入 antd（纯 CSS）：组件量小，省一份重依赖。

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
