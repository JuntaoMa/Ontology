import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { EmptyRun } from "../components/EmptyRun";
import { Card, CardHeader, CardBody } from "../components/ui/Card";
import { Table, Th, Td } from "../components/ui/Table";
import { Pill } from "../components/ui/Badge";
import { FindingList } from "../components/FindingList";

export function RulesSection() {
  const { dataset, run, findings } = useStore();
  const [rules, setRules] = useState<any[]>([]);
  useEffect(() => { api(`/api/rules/${dataset}`).then((d) => setRules(d.rules)).catch(() => setRules([])); }, [dataset]);

  if (!run) return <EmptyRun />;
  const v3 = findings.filter((f) => f.validator_id === "v3.rules");
  const conflicts = v3.filter((f) => f.finding_type === "rule_conflict");
  const competing = v3.filter((f) => f.finding_type === "competing_suggestion");
  const others = v3.filter((f) => !["rule_conflict", "competing_suggestion"].includes(f.finding_type));
  const j2 = findings.filter((f) => f.validator_id === "v5.j2" && f.object_type === "rule");

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="规则表" sub="tier 徽章：hard=红 / heuristic=蓝" />
        <CardBody className="px-0 pb-0">
          <Table>
            <thead><tr><Th>id</Th><Th>tier</Th><Th>guard</Th><Th>结论</Th><Th>evidence 原文</Th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.rule_id} className="hover:bg-[var(--surface-2)]">
                  <Td className="mono">{r.rule_id}</Td>
                  <Td><span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                        style={{ background: r.tier === "hard" ? "var(--sev-violation)" : "var(--sev-info)" }}>{r.tier}</span></Td>
                  <Td className="mono text-xs">{r.guard}</Td>
                  <Td>{r.conclusion.action}<span className="text-[var(--fg-subtle)]">（{r.conclusion.polarity}）</span></Td>
                  <Td className="text-xs text-[var(--fg-subtle)]">{r.evidence?.[0]?.quote}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="V3 hard 冲突（Z3 具体反例）" />
          <CardBody className="flex flex-col gap-3 pt-0">
            {conflicts.length === 0 && <div className="text-xs text-[var(--fg-subtle)]">无冲突</div>}
            {conflicts.map((f) => (
              <div key={f.id} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2.5">
                <div className="text-[13px]">{f.message}</div>
                <pre className="mono mt-1.5 overflow-auto rounded bg-[var(--sev-violation-soft)] p-2 text-[11px]">反例输入：{JSON.stringify(f.locus.counterexample)}</pre>
                <div className="mt-1 text-xs text-[var(--fg-subtle)]">「{f.evidence?.quote_a}」 vs 「{f.evidence?.quote_b}」</div>
              </div>
            ))}
            <div className="mt-1 text-xs font-semibold text-[var(--fg-muted)]">其他缺陷（dead / subsumed / gap）</div>
            <FindingList findings={others} dataset={dataset} />
          </CardBody>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="竞争建议分区" sub="heuristic 常态，非错误" />
            <CardBody className="pt-0"><FindingList findings={competing} empty="无竞争建议" dataset={dataset} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="V5 J2 抽取忠实性" sub="guard vs evidence 原文" right={<Pill tone="accent">advise</Pill>} />
            <CardBody className="pt-0"><FindingList findings={j2} empty="无忠实性问题" dataset={dataset} /></CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
