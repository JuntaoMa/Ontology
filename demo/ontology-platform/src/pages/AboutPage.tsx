import { AppFrame } from "../components/AppFrame";
import { usePlatform } from "../hooks/usePlatformState";

const AGENT_STEPS = [
  {
    title: "理解问题",
    description: "先判断用户是在查数据、执行已知业务流程，还是在提出一个系统暂时还没有的新能力需求。",
  },
  {
    title: "选择 Domain",
    description: "结合问题中的业务对象和术语，定位到最相关的业务域，再进入该域的本体资源。",
  },
  {
    title: "命中资源",
    description: "识别相关的 Object、Link、Function、Action，确认有哪些对象、关系和现成能力可以直接使用。",
  },
  {
    title: "组织处理链路",
    description: "先查询实例，再调用函数计算，最后由动作编排成完整处理流程，整个过程都要保留可解释的中间结果。",
  },
  {
    title: "输出结果与依据",
    description: "最终不仅输出结论，还会展示命中的资源、调用步骤、目的和结果，方便用户核对。",
  },
];

export function AboutPage() {
  const { currentBundle } = usePlatform();

  return (
    <AppFrame
      page="about"
      eyebrow="00 / About"
      title="关于本体平台"
      description=""
    >
      <section className="about-layout">
        <article className="panel about-doc">
          <header className="about-doc__header">
            <p className="eyebrow">About</p>
            <h1>本体平台说明</h1>
            <p className="about-doc__lead">
              本体平台把业务系统中的对象、关系和可执行能力组织成统一、可解释的资源层。
              它的目标不是只回答一个结论，而是让用户清楚看到：问题命中了哪些业务对象，沿着哪些关系展开，调用了哪些能力，以及为什么得到这个结果。
            </p>
          </header>

          <section className="about-doc__section">
            <h2>1. 本体平台是什么</h2>
            <p>
              从用户角度看，本体平台是一个围绕业务对象工作的系统。用户不需要知道底层数据库结构，也不需要自己设计查询路径；
              平台会先识别问题中的业务对象，再结合对象之间的关系和现有能力组织处理链路。
            </p>
            <div className="about-doc__callout">
              例子：在当前样例域 <strong>{currentBundle.domainMeta.name}</strong> 中，用户可以直接询问
              “第三批次切换设计变更时，新物料多久可用”。系统会先识别“设计变更单”“生产批次”“制造零件”“库存批次”等对象，
              再判断应调用哪些函数和动作，最后输出结果和依据。
            </div>
          </section>

          <section className="about-doc__section">
            <h2>2. 语义层</h2>
            <p>
              语义层定义业务世界中“有什么”和“它们如何关联”。它由 <strong>Object</strong> 和 <strong>Link</strong> 两类资源组成。
            </p>
            <dl className="about-doc__definitions">
              <div className="about-doc__definition">
                <dt>Object</dt>
                <dd>
                  表示业务中可以被识别、查询和说明的对象，例如设计变更单、生产批次、采购订单、库存批次。
                </dd>
              </div>
              <div className="about-doc__definition">
                <dt>Link</dt>
                <dd>
                  表示两个对象之间稳定、可说明的关系，例如“设计变更单包含受影响对象”“生产批次运行于生产线状态”。
                </dd>
              </div>
            </dl>
            <p>
              语义层的作用，是为用户问题提供业务坐标系。只有先识别出对象和关系，系统才知道问题落在什么范围内。
            </p>
          </section>

          <section className="about-doc__section">
            <h2>3. 能力层</h2>
            <p>
              能力层定义系统“能做什么”。它由 <strong>Function</strong> 和 <strong>Action</strong> 两类资源组成。
            </p>
            <dl className="about-doc__definitions">
              <div className="about-doc__definition">
                <dt>Function</dt>
                <dd>
                  表示一个可复用的业务处理能力，通常负责计算、判断、归一化、汇总，不直接替代完整业务流程。
                </dd>
              </div>
              <div className="about-doc__definition">
                <dt>Action</dt>
                <dd>
                  表示一个面向业务结果的处理入口，负责把查询、函数调用和控制逻辑组织成完整流程。
                </dd>
              </div>
            </dl>
            <div className="about-doc__callout">
              例子：<code>calc_ready(...)</code> 用于计算物料准备周期；<code>create_report(...)</code> 用于把查询、计算和报告输出组织成完整业务处理链。
            </div>
          </section>

          <section className="about-doc__section">
            <h2>4. Agent 如何处理业务问题</h2>
            <ol className="timeline">
              {AGENT_STEPS.map((step) => (
                <li key={step.title}>
                  <strong>{step.title}</strong>
                  <span>{step.description}</span>
                </li>
              ))}
            </ol>
            <p>
              这意味着问答结果不是一个孤立答案，而是一条可以回看、可以复核的处理过程。
            </p>
          </section>

          <section className="about-doc__section">
            <h2>5. 一个完整例子</h2>
            <p>
              用户问题：<strong>“如果从第三批次开始切换设计变更，涉及的新物料多久可用？”</strong>
            </p>
            <ul className="dense-list about-doc__example-list">
              <li>
                <strong>命中的语义资源</strong>
                <span>设计变更单、生产批次、制造零件、库存批次、采购订单。</span>
              </li>
              <li>
                <strong>命中的能力资源</strong>
                <span>build_scope、check_inventory、calc_ready、create_report。</span>
              </li>
              <li>
                <strong>平台输出</strong>
                <span>结论、证据、处理步骤和可复核的推理链。</span>
              </li>
            </ul>
            <div className="about-doc__callout">
              这类问题的重点不是“只给出一个答案”，而是让用户清楚看到：答案依赖了哪些对象、走过了哪些关系、调用了哪些能力，以及为什么得到这个结果。
            </div>
          </section>
        </article>
      </section>
    </AppFrame>
  );
}
