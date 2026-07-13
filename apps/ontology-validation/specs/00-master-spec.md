# 知识校验 Demo · 主验收规格（Master Spec）

> 本文件是 spec 驱动开发的锚点：每条验收准则（AC）有唯一编号，pytest 测试以 AC 编号命名/标注，
> 实现以让对应测试变绿为完成标准。上游设计：`../docs/design-plan.md`（v2.1）。
> 数据集中的预埋缺陷即 gold set——**每个缺陷必须被预期的层捕获，预期漏报必须真的漏报**。

## 术语

- **veto / score / advise**：三级权限，见 plan §2.4。
- **quarantine**：veto 失败对象的暂存区——不可见于可信层，但可审、可恢复，不丢弃。
- **finding**：advisory 校验产出的结构化违例记录（severity ∈ violation/warning/info）。
- **层命名**：V0 结构、V1 Schema（推理+CQ）、V2 实例（SHACL 双轨）、V3 规则、V4 流程、V5 LLM judge、V6 写入闸门。

---

## AC-ORCH：编排器（registry + DAG + 权限）

| AC | 准则 |
|---|---|
| AC-ORCH-1 | veto 校验器失败 → 该对象（focusNode/artifact 粒度）进 quarantine；其后续校验器对该对象记 `verdict='skip'`，不产出 finding |
| AC-ORCH-2 | `depends_on` 未完成的校验器不执行（拓扑序）；无依赖关系的校验器可任意序 |
| AC-ORCH-3 | advise 权限输出只能叠加在 finding 的 judge 列上或新建 advise 级 finding；不可修改/删除确定性 finding 的 severity/message/status |
| AC-ORCH-4 | 同一对象+同一校验器+同一配置重复运行 → 第二次命中缓存（validation_runs 不重复、judge 不重复调用） |

## AC-O：本体/实例预埋缺陷（loan 数据集）

| AC | 缺陷 | 期望捕获 | 权限路径 |
|---|---|---|---|
| AC-O1 | app001 缺 `hasApplicant` | V2 minimal shape `sh:minCount` | **veto → quarantine(app001)** |
| AC-O2 | p002 `monthlyIncome="八千"` | V2 trusted `sh:datatype` | score |
| AC-O3 | app003 `riskLevel="EXTREME"` | V2 trusted `sh:in` | score（D5 后：J3 给出 HIGH 修复建议） |
| AC-O4 | p004 `age=-5`；app004 `loanAmount=0` | V2 trusted `sh:minInclusive`/`sh:minExclusive` | score |
| AC-O5 | app005 `hasApplicant` 指向 LoanApplication | V2 trusted `sh:class` | score |
| AC-O6 | p007 同时 typed Applicant ∧ Organization（disjoint） | V1 owlrl 推理一致性 | score |
| AC-O7 | p008 两个 `birthDate`（functional） | V2 trusted `sh:maxCount` | score |
| AC-O8 | 无 label 类 / 无 domain 属性 / subclass 环 | V1 pitfall 扫描（info） | score |
| AC-O9 | `TemporaryEmployee rdfs:subClassOf Document`（语义荒谬、逻辑自洽） | **仅 V5 J1**；V1/V2 必须全 miss | advise |

## AC-R：规则预埋缺陷（rules.json，13 条）

| AC | 缺陷 | 期望捕获 |
|---|---|---|
| AC-R-CONFLICT | R2×R4 hard 冲突 | V3 Z3 `SAT(g2∧g4∧incompatible)`，输出具体反例 model（含 income/credit 赋值） |
| AC-R-DEAD | R5 guard 永假 | V3 `UNSAT(g5∧domain)` |
| AC-R-SUBSUME | R6 被 R1 蕴含且结论一致 | V3 `UNSAT(g6∧¬g1)` |
| AC-R-GAP | 规则全集存在未覆盖输入区域 | V3 `SAT(domain∧¬⋁g_i)`，输出具体未覆盖样例 |
| AC-R-COMPETE | R8×R9 heuristic guard 重叠、结论互斥 | V3 登记为 `competing_suggestion`（info），**不得**报为 conflict（violation） |
| AC-R-FAITH (R11) | guard `>=5000` vs evidence「月收入五万」 | **仅 V5 J2**；V3 必须全 miss（规则集逻辑自洽） |

## AC-P：流程预埋缺陷（4 个变体）

| AC | 变体 | 期望捕获 |
|---|---|---|
| AC-P-SOUND | normal | V4 `check_soundness()` = pass；数据感知仿真活动覆盖率 100% |
| AC-P-DEADLOCK | P-deadlock（XOR-split 配 AND-join） | V4 `check_soundness()` = fail，诊断含死锁信息 |
| AC-P-DEADBRANCH | P-dead-branch（gateway 条件 `loan_amount < 0` 不可满足） | V4 **数据感知仿真**该分支活动 0 执行、覆盖率 <100%；（控制流 play-out 可覆盖它——演示两种仿真的差异） |
| AC-P-CROSS | P-rule-violation（gateway 阈值 80万 vs R10 的 50万） | V3×V4 交叉环：约束 `amount>500000 ⇒ ManualReview∈trace` 被违反，违例 trace 回链 R10 |
| AC-P-FAITH | P-edge-unfaithful（边方向与 evidence 引文相反） | **仅 V5 J2**；V4 soundness/仿真必须全 miss |

## AC-CQ：CQ 回归（cqs.json）

| AC | 准则 |
|---|---|
| AC-CQ-PASS | 通过型 CQ verdict=pass |
| AC-CQ-DATAGAP | app009（HIGH 风险无 RiskAssessment）导致 CQ 失败；D5 后 J3 提议分类=数据缺口 |
| AC-CQ-ONTOGAP | 引用本体不存在属性的 CQ 失败；D5 后 J3 提议分类=本体缺口 |

## AC-J：LLM judge 层

| AC | 准则 |
|---|---|
| AC-J-BACKEND | `JudgeBackend` 双适配：配置显式指定 > API key 存在用 Api > claude CLI 可用用 Cli > 否则 cassette 回放 |
| AC-J-CASSETTE | 无 ANTHROPIC_API_KEY 且无 CLI 时，cassette 模式下全管线（含 judge）可完整运行 |
| AC-J-EVIDENCE | judge 输出无证据引用 → 程序侧降级 `uncertain` |
| AC-J-SCHEMA | judge 输出经 Pydantic 校验；解析失败带错误反馈重试 1 次，再失败记 `uncertain` |
| AC-J-ROUTE | J3 只复判 ambiguous 带（warning 级、竞争对、CQ 失败、数值/枚举 violation）；violation 级确定性结论（SMT 冲突、死锁）不送复判 |
| AC-J-COST | 成本卡指标可计算：复判前需人工 finding 数 N、复判后 M（confirm∧conf≥τ 折叠 + likely_false_positive 降权），N>M |

## AC-MUT：错误注入与捕获率矩阵

| AC | 准则 |
|---|---|
| AC-MUT-DET | 形式型变异（删必填/枚举越界/翻转算子/删 edge）被确定性层捕获 |
| AC-MUT-LLM | 语义/忠实性变异（挂错父类/guard 改值偏离 evidence/边序反转）确定性层全 miss、LLM judge 列捕获 |
| AC-MUT-BLIND | 「删 disjointness」全层 miss（故意保留的盲区，矩阵如实呈现） |

## AC-GATE：写入闸门

| AC | 准则 |
|---|---|
| AC-GATE-QUAR | quarantine 对象可见、可恢复（restore 后重新参与校验） |
| AC-GATE-EXPORT | 可信导出只含：非 quarantine ∧ 无 open violation 级 finding 的对象 |
| AC-GATE-REPAIR | 修复建议 accept/dismiss 记入 `review_actions`（含 repair 内容快照） |
