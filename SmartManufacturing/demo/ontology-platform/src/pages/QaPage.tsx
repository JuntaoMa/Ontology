import { startTransition, useState } from "react";
import { AppFrame } from "../components/AppFrame";
import { usePlatform } from "../hooks/usePlatformState";
import { DEMO_CASES, matchDemoCase } from "../data/demoCases";
import type { DemoCase, ResourceType } from "../utils/types";

interface ChatMessage {
  role: "agent" | "user";
  content: string;
}

const RESOURCE_GROUPS = [
  { key: "objects", label: "Object", type: "Object" },
  { key: "links", label: "Link", type: "Link" },
  { key: "functions", label: "Function", type: "Function" },
  { key: "actions", label: "Action", type: "Action" },
] as const;

function renderResourceChips(
  caseItem: DemoCase,
  onSelect: (type: ResourceType, id: string) => void,
) {
  const entries = RESOURCE_GROUPS.flatMap((group) =>
    caseItem.matched[group.key].map((item) => ({
      id: item,
      label: group.label,
      type: group.type,
    })),
  );

  if (!entries.length) {
    return <div className="empty-note">暂无命中资源。</div>;
  }

  return (
    <div className="resource-chip-wall">
      {entries.map((entry) => (
        <button
          key={`${entry.type}:${entry.id}`}
          className={`token token-button token-button--compact token-button--${entry.type.toLowerCase()}`}
          type="button"
          onClick={() => onSelect(entry.type, entry.id)}
        >
          <span className="token-prefix">{entry.label}</span>
          <span>{entry.id}</span>
        </button>
      ))}
    </div>
  );
}

export function QaPage() {
  const { setCurrentDomain, setRecentCaseId, selectResource, state } = usePlatform();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "agent",
      content: "请输入业务问题，系统会先判断问题类型，再展示命中的本体资源、逻辑流程和最终报告。",
    },
  ]);
  const [activeCase, setActiveCase] = useState<DemoCase | null>(
    DEMO_CASES.find((item) => item.id === state.recentCaseId) || DEMO_CASES[0],
  );

  function runQuestion(question: string) {
    const matched = matchDemoCase(question);

    setMessages((previous) => [
      ...previous,
      { role: "user", content: question },
      {
        role: "agent",
        content: matched
          ? `${matched.summary.resultHeadline} 当前判断为“${matched.problemClass}”。`
          : "当前没有命中内置演示案例。你可以尝试询问第三批次物料可用周期，或旧物料报废成本。",
      },
    ]);

    if (!matched) {
      setInput("");
      return;
    }

    startTransition(() => {
      setCurrentDomain(matched.domainId);
      setRecentCaseId(matched.id);
      setActiveCase(matched);
      if (matched.matched.objects[0]) {
        selectResource("Object", matched.matched.objects[0]);
      }
    });

    setInput("");
  }

  return (
    <AppFrame
      page="qa"
      eyebrow="03 / Agent 业务问答"
      title="问答与推理"
      description=""
    >
      <section className="qa-layout">
        <section className="panel chat-panel">
          <div className="panel-head">
            <h2>对话区</h2>
            <span className="panel-badge">Agent</span>
          </div>

          <div className="sample-strip">
            {DEMO_CASES.map((item) => (
              <button key={item.id} className="sample-card" type="button" onClick={() => runQuestion(item.question)}>
                <strong>{item.title}</strong>
                <span>{item.question}</span>
              </button>
            ))}
          </div>

          <div className="chat-thread">
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`chat-bubble chat-bubble--${message.role}`}>
                <span className="chat-role">{message.role === "agent" ? "Agent" : "User"}</span>
                <p>{message.content}</p>
              </article>
            ))}
          </div>

          <form
            className="chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!input.trim()) {
                return;
              }
              runQuestion(input.trim());
            }}
          >
            <label className="field">
              <span>业务问题</span>
              <textarea
                id="qa-question"
                name="qaQuestion"
                rows={4}
                value={input}
                placeholder="例如：当前设计变更单，如果从第三批次开始切换变更，涉及的新物料可用周期是多久？"
                onChange={(event) => setInput(event.target.value)}
              />
            </label>
            <div className="cta-row">
              <button className="button-primary" type="submit">
                发送问题
              </button>
              <button
                className="button-secondary"
                type="button"
                onClick={() => {
                  setMessages([
                    {
                      role: "agent",
                      content: "请输入业务问题，系统会先判断问题类型，再展示命中的本体资源、逻辑流程和最终报告。",
                    },
                  ]);
                  setInput("");
                  setActiveCase(null);
                  setRecentCaseId(null);
                }}
              >
                清空对话
              </button>
            </div>
          </form>
        </section>

        <aside className="panel reasoning-panel">
          <div className="panel-head">
            <h2>上下文与推理链</h2>
            <span className="panel-badge">Trace</span>
          </div>

          {activeCase ? (
            <>
              <div className="summary-grid">
                <div className="summary-card">
                  <span>问题类型</span>
                  <strong>{activeCase.problemClass}</strong>
                </div>
                <div className="summary-card">
                  <span>Domain</span>
                  <strong>{activeCase.summary.domain}</strong>
                </div>
                <div className="summary-card">
                  <span>结论摘要</span>
                  <strong>{activeCase.summary.resultHeadline}</strong>
                </div>
              </div>

              <section className="trace-section">
                <h3>能力判断</h3>
                <p className="plain-text">{activeCase.capabilityAssessment}</p>
              </section>

              <section className="trace-section">
                <h3>命中资源</h3>
                {renderResourceChips(activeCase, selectResource)}
                <div className="inline-actions">
                  <a className="text-link" href="./ontology.html">
                    转到本体图谱定位资源
                  </a>
                </div>
              </section>

              <section className="trace-section">
                <h3>逻辑流程</h3>
                <ol className="step-list">
                  {activeCase.steps.map((step, index) => (
                    <li key={`${step.tool}-${index}`}>
                      <div className="step-head">
                        <span className="step-index">{index + 1}</span>
                        <code>{step.tool}</code>
                      </div>
                      <div className="step-meta">
                        <span><strong>目的：</strong>{step.purpose}</span>
                        <span><strong>结果：</strong>{step.result}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="trace-section">
                <h3>报告结论</h3>
                <ul className="dense-list">
                  {activeCase.conclusions.map((item) => (
                    <li key={item}>
                      <strong>{item}</strong>
                    </li>
                  ))}
                </ul>
              </section>

              {activeCase.proposedCapabilities?.length ? (
                <section className="trace-section">
                  <h3>新增能力建议</h3>
                  {activeCase.proposedCapabilities.map((item) => (
                    <article key={item.id} className="capability-card">
                      <div className="capability-card__head">
                        <span className="token">{item.type}</span>
                        <strong>{item.name}</strong>
                        <code>{item.id}</code>
                      </div>
                      <p>{item.summary}</p>
                      <ul className="dense-list">
                        {item.logic.map((logic) => (
                          <li key={logic}>{logic}</li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </section>
              ) : null}
            </>
          ) : (
            <div className="empty-note">发送问题后，这里会显示命中的本体资源、推理步骤和业务报告。</div>
          )}
        </aside>
      </section>
    </AppFrame>
  );
}
