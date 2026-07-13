import { Card, CardHeader, CardBody } from "../components/ui/Card";
import { AuthorityBadge, Pill } from "../components/ui/Badge";
import { LABEL, CATEGORY_NAME, authorityOf, type Authority } from "../lib/semantics";

/** 关于本系统的设计说明（概念层：不含 web/实现层设计）。
 *  每个校验器给一个具体例子：实际约束内容 + 它拦截的反例。 */

interface VDoc {
  id: string;
  scope: string[];
  engine: string;
  /** 这个校验器实际在查什么（具体约束内容） */
  content: string;
  /** 一个具体反例 */
  ex: {
    label: string;     // 反例标题
    input: string;     // 触发它的具体输入（mono 展示）
    caught: string;    // 为什么被拦下 / 产出什么
    real?: boolean;    // true=demo 预埋的真实缺陷；false=演示性说明
  };
}

const SECTIONS: { cat: string; blurb: string; items: VDoc[] }[] = [
  {
    cat: "intake",
    blurb: "句法入口闸门：结构都不成立的对象，不该进入任何语义校验。",
    items: [{
      id: "intake.structure", scope: ["rule", "process"], engine: "结构断言（Pydantic + 引用完整性）",
      content: "规则 / 流程 IR 必须通过结构 schema 校验；流程的每条边两端都必须是已声明的节点（步骤或网关），不得悬空。",
      ex: {
        label: "悬空边 → 整个流程进 quarantine",
        input: "process loan_x：edge { from: \"risk_assessment\", to: \"notify_applicant\" }\n但 steps/gateways 里从未声明 \"notify_applicant\"",
        caught: "边指向未声明节点 → finding_type=dangling_edge（violation）→ 该流程被隔离，后续 soundness/仿真/交叉环都对它记 skip，不在污染的结构上做语义分析。",
      },
    }],
  },
  {
    cat: "schema",
    blurb: "本体自身的逻辑一致性、建模质量与语义合理性（TBox）。",
    items: [
      {
        id: "schema.consistency", scope: ["schema"], engine: "owlrl OWL-RL 物化 + 矛盾扫描",
        content: "把数据图做 OWL-RL 推理物化后，扫描互斥类的共同个体、owl:Nothing 成员、functional 冲突等。本体里 Applicant 与 Organization 声明为 owl:disjointWith。",
        ex: {
          label: "个体同属互斥类", real: true,
          input: "p007 a Applicant ;\np007 a Organization .   # 但 Applicant ⊥ Organization",
          caught: "推理后发现 p007 同时落入两个互斥类 → disjoint_violation。注意这是『逻辑矛盾』，靠 SHACL 单独看每条三元组发现不了，必须推理。",
        },
      },
      {
        id: "schema.pitfalls", scope: ["schema"], engine: "图模式扫描（OOPS! 子集）",
        content: "建模坏味道：每个 owl:Class 应有 rdfs:label、每个属性应声明 domain 与 range、subClassOf 不得成环。",
        ex: {
          label: "类缺标签 / 属性缺 domain·range / 类层级成环", real: true,
          input: "Cls_0042 a owl:Class .          # 没有 rdfs:label\nmiscFlag a owl:DatatypeProperty . # 没有 domain/range",
          caught: "Cls_0042 → missing_label（info）；miscFlag → missing_domain_range；若出现 A⊑B⊑…⊑A 则 subclass_cycle。都是 score（负证据），不删数据，提示建模需补全。",
        },
      },
      {
        id: "schema.semantic", scope: ["schema"], engine: "LLM judge（J1）",
        content: "判断本体公理的『语义合理性』：subClassOf 是否满足『X 是一种 Y』的常识、属性 domain/range 是否说得通。这是确定性引擎的根本盲区——公理在逻辑上可以完全自洽，却在语义上荒谬。",
        ex: {
          label: "逻辑自洽、语义荒谬的 is-a", real: true,
          input: "TemporaryEmployee rdfs:subClassOf Document .\n（临时雇员 是一种 文档？）",
          caught: "推理机和 SHACL 都查不出任何问题（没有矛盾、没有违反约束），但『临时雇员是一种文档』违反常识 → J1 标 semantic_implausible。权限只到 advise：标记+起草修复，不否决、不删。",
        },
      },
    ],
  },
  {
    cat: "instance",
    blurb: "实例数据（ABox）：必填底线（硬）+ 数据质量（软）+ 能力问题回归。",
    items: [
      {
        id: "instance.required-fields", scope: ["instance"], engine: "SHACL minimal（sh:minCount …）",
        content: "入库的硬底线 shape：每个 LoanApplication 必须有至少一个 hasApplicant 等。违反即不可信，直接拒收。",
        ex: {
          label: "缺必填关系 → veto → quarantine", real: true,
          input: "app001 a LoanApplication .   # 没有任何 hasApplicant 三元组",
          caught: "违反 sh:minCount 1 → finding_type=shacl_min_count（violation）→ app001 进 quarantine。这是少数敢『否决』的校验器：背后是显式、可判定的硬规则。",
        },
      },
      {
        id: "instance.data-quality", scope: ["instance"], engine: "SHACL trusted（datatype / in / 范围 / class / maxCount）",
        content: "可信层 shape：数据类型、枚举取值、数值范围、关系 range、基数。违反=负证据 finding，但不删数据（留待人工/复判）。",
        ex: {
          label: "枚举越界（另含类型/范围/range/基数多种）", real: true,
          input: "app003 riskLevel \"EXTREME\" .   # sh:in 只允许 LOW/MEDIUM/HIGH\np002 monthlyIncome \"八千\" .      # 期望 decimal\np004 age -5 .                      # sh:minInclusive 0",
          caught: "app003 → shacl_enum；p002 → shacl_datatype；p004 → shacl_min_inclusive… 都是 score：记录违例供审，不像必填那样拒收（数据可能只是脏，不是不可信）。",
        },
      },
      {
        id: "instance.competency", scope: ["schema", "instance"], engine: "SPARQL（CQ 回归）",
        content: "能力问题（Competency Question）：每条 CQ 是一个 SPARQL 期望，检验『这个知识库能不能回答它本该回答的问题』。作用对象跨 schema+实例，所以在本体页和实例组都会出现。",
        ex: {
          label: "HIGH 风险申请却查不到风险评估", real: true,
          input: "CQ「每个 HIGH 风险申请都应关联一个 RiskAssessment」\napp009 riskLevel \"HIGH\" .   # 但没有任何 RiskAssessment 关联",
          caught: "SPARQL 查出 app009 作为反例 → cq_failed。失败可能是数据缺口/本体缺口/CQ 过时——确定性层只知道『失败了』，三分类交给 J3 提议（此例=数据缺口）。",
        },
      },
    ],
  },
  {
    cat: "rule",
    blurb: "对『规则集本身』做缺陷检测——规则之间是否冲突/冗余/有死规则/有覆盖盲区。",
    items: [{
      id: "rule.defects", scope: ["rule"], engine: "Z3 SMT（QF_LRA/LIA 可满足性）",
      content: "把每条规则的 guard 翻译成逻辑公式，用可满足性判定：conflict（两条 hard 规则同输入下结论互斥）、dead（guard 永假）、subsumption（被更宽的同结论规则蕴含）、coverage gap（存在无规则覆盖的输入区）、competing（heuristic 重叠，是常态不是错误）。",
      ex: {
        label: "两条 hard 规则在具体输入下冲突", real: true,
        input: "R2: 月收入≥5000 ⇒ 批准（hard）\nR4: 信用分<600 ⇒ 拒绝（hard）\n反例：income=8000 ∧ credit=550 → 两条同时触发，结论互斥",
        caught: "Z3 求解出具体反例赋值（income/credit/age/amount）→ rule_conflict（violation）。关键是它给的是『可复现的具体输入』，不是抽象告警——这是 SMT 相对 SHACL 的独有能力（理论推理）。",
      },
    }],
  },
  {
    cat: "process",
    blurb: "流程模型的健全性与可达性（控制流 + 数据感知两种仿真）。",
    items: [
      {
        id: "process.soundness", scope: ["process"], engine: "Petri 网 + pm4py check_soundness",
        content: "把流程 IR 转成 Petri 网，检查 soundness：有无死锁、不可达活动、不当终止。这是控制流级、与数据无关的结构健全性。",
        ex: {
          label: "XOR 分流配 AND 汇合 → 死锁", real: true,
          input: "g1 (XOR-split) 把流分到 A / B 两条互斥分支，\n下游用 AND-join 等 A 和 B 都到达才继续",
          caught: "XOR 只会走一条分支，AND-join 却要等两条 → 永远等不齐 → process_unsound（violation），诊断含死锁信息。",
        },
      },
      {
        id: "process.simulation", scope: ["process", "rule"], engine: "数据感知仿真 + 控制流 play-out 对照",
        content: "用真实 case 数据按网关条件走 trace，统计每个活动的覆盖率；再与控制流随机 play-out 对照。作用对象含 rule——仿真要读规则 guard 来决定走向。",
        ex: {
          label: "结构上可达、数据上永不可达的死分支", real: true,
          input: "某网关条件 loan_amount < 0（恒不满足）守着活动 express_channel",
          caught: "数据感知仿真里 express_channel 0 次执行（覆盖率<100%），但控制流 play-out 显示它『可达』——两者的差值就是信号：这是一条数据死分支，soundness 看不出来。",
        },
      },
    ],
  },
  {
    cat: "cross",
    blurb: "跨制品校验：规则与流程是否一致、形式化是否忠实于原文。作用对象同时含 rule+process，因此在规则页和流程页都出现。",
    items: [
      {
        id: "cross.rule-process", scope: ["rule", "process"], engine: "规则派生时序约束（mini-Declare）× 仿真 trace",
        content: "把 hard 规则派生成时序约束（如『金额>50万 ⇒ trace 必须含 ManualReview』），跑在数据感知 trace 上找违反。",
        ex: {
          label: "流程阈值与规则阈值打架", real: true,
          input: "R10：贷款>50万必须人工复核\n但某流程网关把人工复核阈值设成 80万",
          caught: "50万~80万之间的 case 走完流程却没经过 manual_review → cross_validation_violation，并把违例 trace 回链到 R10 的原文。单看规则没错、单看流程也没错，错在两者不一致。",
        },
      },
      {
        id: "cross.faithfulness", scope: ["rule", "process"], engine: "LLM judge（J2）",
        content: "比对形式化产物与其抽取来源原文是否忠实：数值/数量级、比较方向与边界、顺序与方向。规则集逻辑可以完全自洽，却与原文不符——确定性引擎查不出。",
        ex: {
          label: "数量级抽错（逻辑自洽但与原文不符）", real: true,
          input: "evidence 原文：「月收入五万元以上方可进入快速通道」\n抽出的 guard：monthly_income >= 5000   # 五万写成了 5000",
          caught: "规则集本身无矛盾，Z3 查不出；但 5000 ≠ 50000，与原文不忠实 → J2 标 unfaithful_extraction（advise）。同类：流程边方向与原文相反。",
        },
      },
    ],
  },
  {
    cat: "meta",
    blurb: "复判收口：不新增检测，而是复审所有模糊地带的 finding，降低人工成本。",
    items: [{
      id: "meta.review", scope: [], engine: "LLM judge（J3）",
      content: "只接『模糊带』finding（warning 级、竞争对、CQ 失败、数值/枚举违例），逐条给 confirm / likely_false_positive / uncertain + 证据指针 + 修复建议；对 CQ 失败给三分类（本体缺口/数据缺口/CQ 过时）。高置信项折叠以减少人工。终审型确定性结论（如 Z3 冲突、死锁）不送复判。",
      ex: {
        label: "复判 + 折叠 → 省人工", real: true,
        input: "对 app003 的 enum 违例：confirm（疑似 HIGH 笔误）+ 修复建议 \"HIGH\"\n对 cq_002 失败：classification = 数据缺口",
        caught: "把需人工处理的 30 条 finding 折叠到 17 条（约省 43%）。折叠≠通过：仍可展开复核，最终写入与否由人定（advise 边界——不可否决、不可删数据）。",
      },
    }],
  },
];

function ValidatorCard({ d }: { d: VDoc }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>{LABEL[d.id] || d.id}</span>
            <span className="mono text-[11px] font-normal text-[var(--fg-subtle)]">{d.id}</span>
            <AuthorityBadge authority={authorityOf(d.id) as Authority} />
            {d.scope.length > 0
              ? d.scope.map((s) => <Pill key={s} tone="neutral">作用 {s}</Pill>)
              : <Pill tone="neutral">作用 findings</Pill>}
          </span>
        }
        sub={d.engine}
      />
      <CardBody className="flex flex-col gap-2 pt-0 text-[13px]">
        <div>
          <span className="font-medium text-[var(--fg-muted)]">实际内容　</span>
          {d.content}
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[var(--fg-muted)]">
            拦截的反例 · {d.ex.label}
            {d.ex.real === false && <Pill tone="neutral">演示性</Pill>}
            {d.ex.real && <Pill tone="neutral">demo 预埋</Pill>}
          </div>
          <pre className="mono mb-1.5 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface)] p-2 text-[11px] leading-relaxed text-[var(--fg)]">{d.ex.input}</pre>
          <div className="text-[12px] text-[var(--fg-muted)]">→ {d.ex.caught}</div>
        </div>
      </CardBody>
    </Card>
  );
}

export function AboutSection() {
  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-5">
      <Card>
        <CardHeader title="关于本系统的设计" sub="知识校验系统的设计思路（概念层）——每个校验器附一个具体例子" />
        <CardBody className="flex flex-col gap-3 pt-0 text-[13px] leading-relaxed">
          <p>
            知识抽取（从文本/业务系统抽出<b>本体、规则、流程</b>）难免出错：结构错、数据脏、逻辑矛盾、
            规则冲突、流程死锁，还有最隐蔽的『逻辑自洽但语义或事实错』。直接写进知识库会污染所有下游。
            本系统在<b>抽取产物</b>与<b>可信知识库</b>之间放一道<b>分层校验闸门</b>：
            只有通过校验的对象进入可信本体/KG，失败的进隔离区（quarantine）——可审、可恢复、不丢弃。
          </p>
          <div className="text-[12px] text-[var(--fg-subtle)]">
            抽取产物 → 校验流水线（registry + DAG） → 写入闸门 → 可信本体 / KG（+ 隔离区）
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="四条核心设计思路" />
        <CardBody className="flex flex-col gap-3.5 pt-0 text-[13px] leading-relaxed">
          <div>
            <div className="font-semibold">① 校验器按『作用对象』组织，不用抽象层号</div>
            每个校验器盯着一类制品——<b>本体 / 实例 / 规则 / 流程</b>。它绑定的作用对象（scope）同时决定两件事：
            归在哪一组展示、以及『改了什么制品要不要重跑它』。所以新增一个本体实例时，流程校验器根本不必启动。
          </div>
          <div>
            <div className="font-semibold">② 三级权限，且『权力 = 背后规格的显式可判定程度』</div>
            <div className="mt-1.5 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)]">
              <table className="w-full text-[12px]">
                <thead><tr className="bg-[var(--surface-2)] text-[var(--fg-muted)]">
                  <th className="px-2.5 py-1 text-left font-medium">权限</th>
                  <th className="px-2.5 py-1 text-left font-medium">背后是什么</th>
                  <th className="px-2.5 py-1 text-left font-medium">能做什么</th>
                </tr></thead>
                <tbody>
                  <tr className="border-t border-[var(--border)]">
                    <td className="px-2.5 py-1"><AuthorityBadge authority="veto" /></td>
                    <td className="px-2.5 py-1">显式、可判定的硬规则（结构断言、必填 shape）</td>
                    <td className="px-2.5 py-1">直接否决 → 进 quarantine</td>
                  </tr>
                  <tr className="border-t border-[var(--border)]">
                    <td className="px-2.5 py-1"><AuthorityBadge authority="score" /></td>
                    <td className="px-2.5 py-1">显式但软的约束（数据质量 shape、Z3、推理机、Petri）</td>
                    <td className="px-2.5 py-1">记负证据 finding，不删数据</td>
                  </tr>
                  <tr className="border-t border-[var(--border)]">
                    <td className="px-2.5 py-1"><AuthorityBadge authority="advise" /></td>
                    <td className="px-2.5 py-1">没有显式规则、只能靠判断（LLM）</td>
                    <td className="px-2.5 py-1">调置信度/起草修复；<b>不可否决、不可删数据</b></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-1.5 text-[12px] text-[var(--fg-subtle)]">
              形式从『结构断言 → SHACL → 推理/SPARQL → SMT → Petri/时序 → LLM』，越往后表达力越强、可判定性越弱，
              所以权限越低。这条线决定了『为什么这个校验器能有这么大/这么小的权力』。
            </div>
          </div>
          <div>
            <div className="font-semibold">③ registry + DAG 拓扑调度，确定性优先、LLM 补盲区</div>
            所有校验器登记在一张依赖图里，按拓扑序执行；veto 失败对某对象短路（后续对它记 skip）。
            确定性引擎（SHACL / 推理机 / SMT / Petri）先跑，LLM judge 只接它们处理不了的『语义合理性』『抽取忠实性』，
            并对模糊地带做复判以降低人工成本。还支持<b>按变更范围选择性触发</b>：只改了实例，就只跑实例相关 + 复判。
          </div>
          <div>
            <div className="font-semibold">④ 互补性是可证伪的</div>
            通过错误注入（变异）证明分工真的成立：形式型错误被确定性层抓、语义/忠实性错误<b>只有</b> LLM 抓、
            而某些被故意保留的盲区（例如删掉一条 disjoint 公理后，没人知道这条约束本该存在）如实呈现为漏报。
            校验能力本身被量化、可审计，而不是一句『我们都检查了』。
          </div>
        </CardBody>
      </Card>

      {SECTIONS.map((s) => (
        <div key={s.cat} className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2 px-1">
            <h2 className="text-[15px] font-semibold">{CATEGORY_NAME[s.cat] || s.cat}</h2>
            <span className="text-[12px] text-[var(--fg-subtle)]">{s.blurb}</span>
          </div>
          {s.items.map((d) => <ValidatorCard key={d.id} d={d} />)}
        </div>
      ))}

      <Card>
        <CardHeader title="写入闸门（收口）" sub="校验之后，谁进可信库" />
        <CardBody className="pt-0 text-[13px] leading-relaxed">
          可信导出 = <b>非 quarantine</b> ∧ <b>无 open 的 violation 级 finding</b> 的对象。
          被否决的对象留在隔离区可审、可 restore 重跑；score/advise 的 finding 由人工 accept/dismiss，
          修复建议可一键采纳并记录。<b>终审在人</b>——LLM 永远不替系统做删除或否决。
        </CardBody>
      </Card>
    </div>
  );
}
