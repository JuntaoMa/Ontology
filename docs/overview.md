# 知识校验 Demo · 模块与设计思路总览（以 loan 场景为例）

> 配套：设计文档 `../../docs/validation-demo-plan.md`（v2.1）、功能规格 `../specs/00-master-spec.md`、
> 前端规格 `../specs/10-frontend-redesign-spec.md`。本文是 demo 的导览。

## 一、一句话定位

一个**业务知识（本体/规则/流程）的混合校验工作台**：确定性引擎做形式判定、LLM judge
做语义判定与复判、人工在写入闸门终审——三者权限严格分级，谁也不能越界。

## 二、数据形态：loan 三件套，缺陷即 gold

贷款审批天然同时有三类知识 artifact，每件都**预埋了缺陷，缺陷清单就是验收 gold**
（`specs/00-master-spec.md` 的 AC 编号）：

| artifact | 内容 | 预埋缺陷举例 |
|---|---|---|
| 本体 + 30 实例 | Applicant / LoanApplication / RiskAssessment… + 申请数据 | O1 缺申请人、O3 风险等级 EXTREME、O6 同时是人又是机构、**O9 临时雇员⊑材料文档** |
| 13 条规则 IR | guard→结论 + tier + evidence 原文 | R2×R4 冲突、R5 死规则、R8×R9 竞争建议、**R11 guard 写 5000 但原文「五万」** |
| 5 个流程变体 | 提交→检查→评估→分流→审批 | P-deadlock、P-dead-branch、P-rule-violation、**P-edge-unfaithful（边向与原文相反）** |

加粗的三个（O9 / R11 / P-edge）是关键：**逻辑全自洽、确定性引擎全 miss，只有 LLM 能抓**
——它们存在就是为了证明确定性×LLM 的互补性。

## 三、校验流水线：七层 + 横切（概念 V0–V6）

```
                    loan 三件套（含预埋缺陷）
                            │
   ┌────────────────────────┼────────────────────────┐
   ▼                        ▼                        ▼
本体+实例                规则 IR                  流程 IR
   │                        │                        │
┌──┴───────────────────────┴────────────────────────┴──┐
│ V0 结构 (Pydantic)  ── veto ──▶ 失败进 quarantine       │
│ V1 Schema (owlrl/pitfall/CQ)   ── score                │
│ V2 实例 (SHACL minimal=veto / trusted=score)           │
│ V3 规则 (Z3 缺陷 + tier)       ── score                │
│ V4 流程 (soundness+双仿真+交叉环) ── score              │
│ V5 LLM Judge (J1语义/J2忠实/J3复判+修复) ── advise(不否决)│
└──────────────────────────┬─────────────────────────────┘
                           ▼
              V6 写入闸门：收件箱 triage + quarantine + 可信导出（人工终审）

  横切：错误注入器 → 13 变异算子 → 捕获率矩阵（确定性抓 / 仅 LLM 抓 / 全层盲区）
```

每层在 loan 里抓什么、持什么权限：

| 层 | 引擎 | loan 里抓到 | 权限 |
|---|---|---|---|
| **V0 结构** | Pydantic IR 校验 | 规则/流程 IR 字段缺失、evidence 空、悬空边 | **veto** |
| **V1 Schema** | owlrl 推理 + pitfall + CQ | O6 disjoint 矛盾；O8 无 label/无 domain/subclass 环；CQ 查出 app009（HIGH 无评估=数据缺口）、hasGuarantor（本体缺口） | score |
| **V2 实例** | pySHACL 双轨 | O1 缺申请人（minimal→**quarantine**）；O2/O3/O4/O5/O7（trusted） | **veto** + score |
| **V3 规则** | Z3 SMT + tier | R2×R4 给**具体反例**、R5 dead、R6 subsumed、覆盖 gap；R8×R9 登记为**竞争建议而非冲突** | score |
| **V4 流程** | PM4Py soundness + 双仿真 + mini-Declare | P-deadlock（死锁）、P-dead-branch（数据感知覆盖率<100%）、P-rule-violation（交叉环回链 R10） | score |
| **V5 LLM Judge** | J1 语义 / J2 忠实 / J3 复判+修复 | **O9**（J1）、**R11 + P-edge**（J2）；J3 复判 V1–V4 的 ambiguous finding、给修复建议、CQ 三分类 | **advise** |
| **V6 写入闸门** | 收件箱 + quarantine + 导出 | 人工 triage、quarantine 恢复、可信图谱导出 | 人工终审 |
| **横切** | 错误注入器 | 13 变异算子 → 捕获率矩阵三类格局 | — |

**三个 judge 各司其职**：J1 判「名称-公理」语义合理性（临时雇员不是文档）；J2 判「形式化 vs
evidence 原文」忠实性（5000≠五万、边向反了）；J3 复判确定性层的 ambiguous finding 并起草修复
——只接 warning/竞争/CQ/数值枚举这类「可能误报或可一键修」的带，**死锁/冲突这类确定性终审结论
不送复判**。

## 四、贯穿的设计思路（为什么这么做）

1. **权限分级的混合裁判**——确定性引擎在形式问题上终审（veto/score），LLM 只能 advise：调置信度、
   起草修复、产新语义 finding，**不能否决、不能删数据、不能自动应用修复**。
2. **双语义轴分通道**（前端核心）——严重度用填充色、权限（veto/score/advise）用图标+边框，
   六个含义两条轴永不抢同一视觉通道。
3. **violation 是负证据，不是删除指令**——veto 失败进 quarantine（可见、可审、可恢复），不丢弃。
4. **证据优先 / 可解释**——每个 finding 带定位：SHACL 给 focusNode/path、Z3 给具体反例 model、
   交叉环给违例 trace 并回链源规则原文、judge 给必须引用证据的 rationale（引用不在源材料则降级
   uncertain）。
5. **tier 分级语义**——hard×hard 冲突才报错；heuristic 互斥是常态，登记为「竞争建议」（info）。
6. **无真实日志的流程校验**——业务流程从没被执行过，没有 event log，所以用合成 trace + 规则派生
   Declare 约束做交叉验证环（P-rule-violation 就这么抓的）。
7. **校验器的校验**——错误注入矩阵回答「这套管线对已知错误抓住几成」，且**故意保留「删 disjoint」
   整行漏报**作为可证伪的盲区证书。
8. **人工成本可量化**——J3 复判把高置信项折叠，仪表盘头条「需人审 N→M，降 X%」（实录 20–38%）；
   折叠≠通过，仍可展开，终审在人。

## 五、工程支柱

- **registry + DAG + 三级权限**：校验器注册元数据，拓扑调度，veto 短路，幂等缓存。
- **judge 三模式自动选择**：CLI（订阅，零费）/ API / **cassette 回放**——无任何凭证也能离线全
  流程跑（含真实 opus 录制的 O9/R11/P-edge）。
- **spec 驱动 + 53 测试**：每条 AC → pytest gold 断言，「预期捕获的必须抓、预期漏报的必须漏」。
- **可复现性纪律**：rdflib/Z3 的遍历顺序与反例跨进程会漂移 → 排序、规范化、过滤 volatile，保证
  cassette 稳定命中（三 seed 验证过）。

## 六、前端形态

亮色企业风 + 左侧栏 + 统一 findings 收件箱（Tailwind v4 + 手写 shadcn 风格原语 + Cytoscape +
ECharts）。findings 逐条 triage 集中在**收件箱**（Sentry 式：分组/筛选/judge 折叠/详情抽屉，详情含
**原始输入条目** + 定位 + 证据 + judge 复判 + 修复建议）；**写入闸门**只管 quarantine 恢复与可信导出。
