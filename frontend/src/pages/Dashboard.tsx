import { SEV_COLOR, LAYER_NAME, layerOf } from "../api";

export default function Dashboard({ run, findings }: any) {
  if (!run) return <div className="panel">点击「运行全管线」开始（首次 judge 调用走缓存/cassette 时秒级完成）。</div>;
  const cost = run.cost_card;
  const sev = run.findings_by_severity || {};
  return (
    <>
      <div className="cards">
        <div className="card"><h4>veto 门禁</h4>
          <div className="big">{run.quarantine.length}</div>
          <div className="sub">对象进入 quarantine</div></div>
        {["violation", "warning", "info"].map((s) => (
          <div className="card" key={s}><h4>{s} findings</h4>
            <div className="big" style={{ color: SEV_COLOR[s] }}>{sev[s] || 0}</div></div>
        ))}
        <div className="card" style={{ background: "#f6ffed" }}>
          <h4>人工成本节约（judge 复判）</h4>
          <div className="big">{cost.n_before} → {cost.n_after}</div>
          <div className="sub">折叠 {cost.folded} 条，降低 {cost.saving_pct}%（折叠≠通过，可展开复核）</div>
        </div>
        <div className="card"><h4>judge 缓存</h4>
          <div className="big">{run.judge_stats.cached_responses}</div>
          <div className="sub">tokens {run.judge_stats.tokens_in}↑ {run.judge_stats.tokens_out}↓</div></div>
      </div>
      <div className="panel">
        <h3>校验器执行（registry + DAG + 三级权限）</h3>
        <table>
          <thead><tr><th>层</th><th>校验器</th><th>权限</th><th>verdict</th><th>缓存</th><th>耗时</th><th>findings</th></tr></thead>
          <tbody>
            {run.validators.map((v: any) => (
              <tr key={v.validator_id}>
                <td>{LAYER_NAME[layerOf(v.validator_id)]}</td>
                <td className="mono">{v.validator_id}</td>
                <td><span className="badge" style={{
                  background: v.authority === "veto" ? "#cf1322" :
                              v.authority === "advise" ? "#722ed1" : "#1677ff" }}>
                  {v.authority}</span></td>
                <td>{v.verdict}</td>
                <td>{v.cached ? "✓" : ""}</td>
                <td className="muted">{v.duration_ms}ms</td>
                <td>{findings.filter((f: any) => f.validator_id === v.validator_id).length}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </>
  );
}
