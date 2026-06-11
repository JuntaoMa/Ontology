import { useEffect, useState } from "react";
import { api } from "../api";
import FindingTable from "../components/FindingTable";

export default function Rules({ dataset, findings }: any) {
  const [rules, setRules] = useState<any[]>([]);
  useEffect(() => {
    api(`/api/rules/${dataset}`).then((d) => setRules(d.rules)).catch(() => setRules([]));
  }, [dataset]);

  const v3 = findings.filter((f: any) => f.validator_id === "v3.rules");
  const conflicts = v3.filter((f: any) => f.finding_type === "rule_conflict");
  const competing = v3.filter((f: any) => f.finding_type === "competing_suggestion");
  const others = v3.filter((f: any) => !["rule_conflict", "competing_suggestion"].includes(f.finding_type));
  const j2 = findings.filter((f: any) => f.validator_id === "v5.j2" && f.object_type === "rule");

  return (
    <>
      <div className="panel">
        <h3>规则表（tier 徽章；hard=红 / heuristic=蓝）</h3>
        <table>
          <thead><tr><th>id</th><th>tier</th><th>guard</th><th>结论</th><th>evidence 原文</th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.rule_id}>
                <td className="mono">{r.rule_id}</td>
                <td><span className="badge" style={{ background: r.tier === "hard" ? "#cf1322" : "#1677ff" }}>{r.tier}</span></td>
                <td className="mono">{r.guard}</td>
                <td>{r.conclusion.action}（{r.conclusion.polarity}）</td>
                <td className="muted">{r.evidence?.[0]?.quote}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <div className="col panel">
          <h3>V3 hard 冲突（Z3 反例）</h3>
          {conflicts.map((f: any) => (
            <div key={f.id} style={{ marginBottom: 10 }}>
              <div>{f.message}</div>
              <div className="mono muted">反例输入：{JSON.stringify(f.locus.counterexample)}</div>
              <div className="muted">「{f.evidence?.quote_a}」 vs 「{f.evidence?.quote_b}」</div>
            </div>))}
          <h3>其他缺陷（dead / subsumed / gap）</h3>
          <FindingTable findings={others} />
        </div>
        <div className="col">
          <div className="panel">
            <h3>竞争建议分区（heuristic 常态，非错误）</h3>
            <FindingTable findings={competing} />
          </div>
          <div className="panel">
            <h3>V5 J2 抽取忠实性（guard vs 原文）</h3>
            <FindingTable findings={j2} />
          </div>
        </div>
      </div>
    </>
  );
}
