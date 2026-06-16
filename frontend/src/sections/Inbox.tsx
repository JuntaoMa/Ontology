import { useMemo, useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { api, type Finding } from "../api";
import { useStore } from "../store";
import { EmptyRun } from "../components/EmptyRun";
import { Card, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { SeverityBadge, AuthorityBadge, Pill } from "../components/ui/Badge";
import { Sheet } from "../components/ui/Sheet";
import { JudgeBox } from "../components/ui/JudgeBox";
import { SourceBlock } from "../components/SourceBlock";
import { authorityOf, layerOf, LAYER_NAME, type Severity } from "../lib/semantics";

const TAU = 0.85;
const isFolded = (f: Finding) =>
  (f.judge_verdict === "confirm" || f.judge_verdict === "likely_false_positive") &&
  (f.judge_confidence ?? 0) >= TAU;

type GroupBy = "type" | "object" | "layer" | "none";

export function Inbox() {
  const { run, findings, refresh, dataset } = useStore();
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [showFolded, setShowFolded] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [selected, setSelected] = useState<Finding | null>(null);

  const visible = useMemo(() => findings.filter((f) => {
    if (!showResolved && f.status !== "open") return false;
    if (sevFilter.size && !sevFilter.has(f.severity as Severity)) return false;
    if (!showFolded && f.status === "open" && isFolded(f)) return false;
    return true;
  }), [findings, sevFilter, showFolded, showResolved]);

  const groups = useMemo(() => {
    const key = (f: Finding) =>
      groupBy === "type" ? f.finding_type
      : groupBy === "object" ? String(f.object_id).split("#").pop()!
      : groupBy === "layer" ? LAYER_NAME[layerOf(f.validator_id)]
      : "全部";
    const m = new Map<string, Finding[]>();
    visible.forEach((f) => {
      const k = key(f);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(f);
    });
    return [...m.entries()];
  }, [visible, groupBy]);

  if (!run) return <EmptyRun />;
  const cost = run.cost_card;
  const openTotal = findings.filter((f) => f.status === "open").length;
  const foldedCount = findings.filter((f) => f.status === "open" && isFolded(f)).length;

  async function act(id: number, action: string) {
    await api(`/api/findings/${id}/action?action=${action}`, { method: "POST" });
    setSelected(null);
    await refresh();
  }

  const SEVS: Severity[] = ["violation", "warning", "info"];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-3.5">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--ok)]" />
            <div>
              <div className="text-xs text-[var(--fg-subtle)]">人工成本节约（judge 复判后）</div>
              <div className="text-lg font-bold">
                需逐条人审 {cost.n_before} <span className="text-[var(--fg-subtle)]">→</span> {cost.n_after}
                <span className="ml-2 text-sm font-medium text-[var(--ok)]">降低 {cost.saving_pct}%</span>
              </div>
            </div>
          </div>
          <div className="text-xs leading-relaxed text-[var(--fg-subtle)]">
            judge 已折叠 <b className="text-[var(--fg-muted)]">{foldedCount}</b> 条高置信项（confirm/疑似误报，≥{TAU}）<br />
            折叠 ≠ 自动通过——仍在队列可展开复核，写入闸门终审在人
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {SEVS.map((s) => {
          const on = sevFilter.has(s);
          return (
            <button key={s} onClick={() => {
              const next = new Set(sevFilter); on ? next.delete(s) : next.add(s); setSevFilter(next);
            }} className={on ? "opacity-100" : "opacity-45 hover:opacity-80"}>
              <SeverityBadge severity={s} />
            </button>
          );
        })}
        <div className="mx-1 h-4 w-px bg-[var(--border)]" />
        <span className="text-xs text-[var(--fg-subtle)]">分组</span>
        <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="h-8 text-xs">
          <option value="type">按类型</option>
          <option value="object">按对象</option>
          <option value="layer">按层</option>
          <option value="none">不分组</option>
        </Select>
        <label className="ml-2 flex items-center gap-1.5 text-xs text-[var(--fg-muted)]">
          <input type="checkbox" checked={showFolded} onChange={(e) => setShowFolded(e.target.checked)} />
          展开 judge 已折叠（{foldedCount}）
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)]">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          含已处理
        </label>
        <span className="ml-auto text-xs text-[var(--fg-subtle)]">{visible.length} / 共 {openTotal} 条 open</span>
      </div>

      <div className="flex flex-col gap-3">
        {groups.map(([name, items]) => (
          <Card key={name}>
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
              <span className="mono text-xs font-semibold">{name}</span>
              <Pill>{items.length}</Pill>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {items.map((f) => <Row key={f.id} f={f} onClick={() => setSelected(f)} />)}
            </div>
          </Card>
        ))}
        {!groups.length && <div className="py-12 text-center text-sm text-[var(--fg-subtle)]">当前筛选下无 finding</div>}
      </div>

      <DetailSheet f={selected} onClose={() => setSelected(null)} act={act} dataset={dataset} />
    </div>
  );
}

function Row({ f, onClick }: { f: Finding; onClick: () => void }) {
  const folded = isFolded(f);
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--surface-2)] ${folded ? "opacity-55" : ""}`}>
      <SeverityBadge severity={f.severity as Severity} />
      <AuthorityBadge authority={authorityOf(f.validator_id)} showLabel={false} />
      <span className="mono shrink-0 text-xs text-[var(--fg-muted)]">{String(f.object_id).split("#").pop()}</span>
      <span className="flex-1 truncate text-[13px]">{f.message}</span>
      {f.judge_verdict && (
        <span className="shrink-0 text-[11px]" style={{ color: "var(--authority-advise)" }}>⚖ {f.judge_verdict}</span>
      )}
      {f.status !== "open" && <Pill tone={f.status === "accepted" ? "ok" : "neutral"}>{f.status}</Pill>}
      <ChevronRight size={14} className="shrink-0 text-[var(--fg-subtle)]" />
    </button>
  );
}

function DetailSheet({ f, onClose, act, dataset }: {
  f: Finding | null; onClose: () => void; act: (id: number, action: string) => void; dataset: string;
}) {
  return (
    <Sheet open={!!f} onClose={onClose} title={f && <span className="mono">{f.finding_type}</span>}>
      {f && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={f.severity as Severity} />
            <AuthorityBadge authority={authorityOf(f.validator_id)} />
            <Pill>{LAYER_NAME[layerOf(f.validator_id)]}</Pill>
            <span className="mono text-xs text-[var(--fg-subtle)]">{f.validator_id}</span>
          </div>
          <div>
            <div className="text-xs text-[var(--fg-subtle)]">对象</div>
            <div className="mono break-all">{f.object_id}</div>
          </div>
          <SourceBlock dataset={dataset} objectType={f.object_type} objectId={f.object_id} />
          <div>
            <div className="text-xs text-[var(--fg-subtle)]">校验结论</div>
            <div>{f.message}</div>
          </div>
          {f.locus && Object.keys(f.locus).length > 0 && (
            <div>
              <div className="text-xs text-[var(--fg-subtle)]">定位 / 诊断</div>
              <pre className="mono mt-1 overflow-auto rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-2 text-[11px]">{JSON.stringify(f.locus, null, 1)}</pre>
            </div>
          )}
          {f.evidence && (
            <div>
              <div className="text-xs text-[var(--fg-subtle)]">证据</div>
              <pre className="mono mt-1 overflow-auto rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-2 text-[11px]">{JSON.stringify(f.evidence, null, 1)}</pre>
            </div>
          )}
          {f.judge_verdict && (
            <JudgeBox verdict={f.judge_verdict} confidence={f.judge_confidence ?? undefined}
                      rationale={f.judge_rationale ?? undefined} repair={f.repair} />
          )}
          {f.status === "open" ? (
            <div className="mt-2 flex gap-2">
              <Button variant="primary" size="sm" onClick={() => act(f.id, "accept")}>确认问题</Button>
              <Button size="sm" onClick={() => act(f.id, "dismiss")}>忽略</Button>
              {f.repair?.suggestion && (
                <Button size="sm" onClick={() => act(f.id, "accept_repair")}>采纳修复</Button>
              )}
            </div>
          ) : (
            <Pill tone={f.status === "accepted" ? "ok" : "neutral"}>已{f.status === "accepted" ? "确认" : "忽略"}</Pill>
          )}
        </div>
      )}
    </Sheet>
  );
}
