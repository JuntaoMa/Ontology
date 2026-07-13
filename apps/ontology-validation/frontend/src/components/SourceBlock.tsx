import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { api } from "../api";

/** finding 详情里的「原始输入条目」：展示对象本身（rdf 三元组 / 规则 IR / 流程 IR / CQ）。 */
export function SourceBlock({ dataset, objectType, objectId }: {
  dataset: string; objectType: string; objectId: string;
}) {
  const [src, setSrc] = useState<any>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setSrc(null); setErr(false);
    api(`/api/source/${dataset}?object_type=${encodeURIComponent(objectType)}&object_id=${encodeURIComponent(objectId)}`)
      .then(setSrc).catch(() => setErr(true));
  }, [dataset, objectType, objectId]);

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)]/40">
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--fg-muted)]">
        <FileText size={13} /> 原始输入条目
      </div>
      <div className="px-3 py-2">
        {err && <div className="text-xs text-[var(--fg-subtle)]">无法加载原始条目</div>}
        {!src && !err && <div className="text-xs text-[var(--fg-subtle)]">加载中…</div>}
        {src && <Render src={src} />}
      </div>
    </div>
  );
}

function Render({ src }: { src: any }) {
  if (src.kind === "rdf") return <Rdf src={src} />;
  if (src.kind === "rule") return <Rules src={src} />;
  if (src.kind === "process") return <Process src={src} />;
  if (src.kind === "cq") return <Cq src={src} />;
  return <div className="text-xs text-[var(--fg-subtle)]">{src.note}</div>;
}

function Rdf({ src }: { src: any }) {
  return (
    <div>
      <div className="mb-1.5 text-xs">
        <span className="mono font-semibold">{src.local}</span>
        {src.label && <span className="text-[var(--fg-subtle)]">（{src.label}）</span>}
      </div>
      <table className="w-full text-xs">
        <tbody>
          {src.triples.map((t: any, i: number) => (
            <tr key={i} className="border-t border-[var(--border)]/60">
              <td className="mono py-1 pr-3 text-[var(--fg-muted)] align-top">{t.p}</td>
              <td className="mono py-1" style={t.o_is_uri ? undefined : { color: "var(--accent)" }}>
                {t.o}{t.datatype && <span className="text-[var(--fg-subtle)]"> ^^{t.datatype}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rules({ src }: { src: any }) {
  const rules = (src.rules || []).slice(0, 4);
  return (
    <div className="flex flex-col gap-2">
      {src.note && <div className="text-xs text-[var(--fg-subtle)]">{src.note}</div>}
      {rules.map((r: any) => (
        <div key={r.rule_id} className="text-xs">
          <div className="flex items-center gap-1.5">
            <span className="mono font-semibold">{r.rule_id}</span>
            <span className="rounded-full px-1.5 text-[10px] font-medium text-white"
                  style={{ background: r.tier === "hard" ? "var(--sev-violation)" : "var(--sev-info)" }}>{r.tier}</span>
          </div>
          <div className="mono mt-0.5">guard: {r.guard}</div>
          <div className="mono">⇒ {r.conclusion.action}（{r.conclusion.polarity}）</div>
          {r.evidence?.[0] && (
            <div className="mt-0.5 text-[var(--fg-subtle)]">原文：「{r.evidence[0].quote}」</div>
          )}
        </div>
      ))}
    </div>
  );
}

function Process({ src }: { src: any }) {
  const p = src.process;
  return (
    <div className="text-xs">
      <div className="mb-1 text-[var(--fg-subtle)]">{p.description}</div>
      <div className="font-semibold text-[var(--fg-muted)]">边（from → to）与原文</div>
      <div className="mt-0.5 flex flex-col gap-1">
        {p.edges.map((e: any, i: number) => (
          <div key={i}>
            <span className="mono">{e.from} → {e.to}{e.condition ? `  [${e.condition}]` : ""}</span>
            {e.evidence?.[0] && <div className="text-[var(--fg-subtle)]">原文：「{e.evidence[0].quote}」</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Cq({ src }: { src: any }) {
  const c = src.cq;
  return (
    <div className="text-xs">
      <div>{c.nl_question}</div>
      <pre className="mono mt-1 overflow-auto rounded bg-[var(--surface-2)] p-2 text-[11px]">{c.query}</pre>
      <div className="mt-1 text-[var(--fg-subtle)]">期望：{c.expected.mode}
        {c.expected.answers ? `（${c.expected.answers.join(", ")}）` : ""}</div>
    </div>
  );
}
