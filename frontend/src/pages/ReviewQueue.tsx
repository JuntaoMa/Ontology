import { useState } from "react";
import { api, SEV_COLOR } from "../api";

const ORDER: Record<string, number> = { uncertain: 0, confirm: 2, likely_false_positive: 3 };

export default function ReviewQueue({ run, findings, refreshFindings, dataset }: any) {
  const [showFolded, setShowFolded] = useState(false);
  if (!run) return <div className="panel">先运行全管线。</div>;

  const open = findings.filter((f: any) => f.status === "open");
  const folded = (f: any) =>
    ["confirm", "likely_false_positive"].includes(f.judge_verdict) && f.judge_confidence >= 0.85;
  const visible = showFolded ? open : open.filter((f: any) => !folded(f));
  const groups: Record<string, any[]> = {};
  visible.forEach((f: any) => (groups[f.finding_type] ||= []).push(f));
  const sorted = Object.entries(groups).sort(
    (a, b) => (ORDER[a[1][0].judge_verdict] ?? 1) - (ORDER[b[1][0].judge_verdict] ?? 1));

  async function act(id: number, action: string) {
    await api(`/api/findings/${id}/action?action=${action}`, { method: "POST" });
    refreshFindings();
  }
  async function restore(qid: number) {
    await api(`/api/quarantine/${qid}/restore`, { method: "POST" });
    refreshFindings();
  }

  return (
    <>
      <div className="panel">
        <h3>V6 写入闸门 · 审核队列（按 finding_type 聚合打包审；judge 折叠 {open.length - visible.length} 条）</h3>
        <label className="muted">
          <input type="checkbox" checked={showFolded}
                 onChange={(e) => setShowFolded(e.target.checked)} /> 展开 judge 已折叠项
        </label>
        <a className="btn small" style={{ float: "right" }}
           href={`/api/export/${dataset}/trusted.ttl?run_id=${run.run_id}`} target="_blank">
          ⬇ 导出可信图谱（通过闸门部分）</a>
      </div>
      {run.quarantine.length > 0 && (
        <div className="panel">
          <h3>Quarantine（veto 拒收：可见、可审、可恢复）</h3>
          <table><tbody>
            {run.quarantine.map((q: any) => (
              <tr key={q.qid}>
                <td className="mono">{q.object_id.split("#").pop()}</td>
                <td className="muted">拒收原因：{q.reason}</td>
                <td><button className="btn small" onClick={() => restore(q.qid)}>恢复</button></td>
              </tr>))}
          </tbody></table>
        </div>)}
      {sorted.map(([ftype, fs]) => (
        <div className="panel" key={ftype}>
          <h3>{ftype} <span className="muted">×{fs.length}（一类问题打包审）</span></h3>
          <table><tbody>
            {fs.map((f: any) => (
              <tr key={f.id} className={folded(f) ? "folded" : ""}>
                <td style={{ width: 90 }}>
                  <span className="badge" style={{ background: SEV_COLOR[f.severity] }}>{f.severity}</span>
                  <div className="muted mono">{f.validator_id}</div>
                </td>
                <td>
                  <div className="mono">{String(f.object_id).split("#").pop()}</div>
                  <div>{f.message}</div>
                  {f.judge_verdict && (
                    <div className={`judge-box ${f.judge_verdict === "likely_false_positive" ? "fp" : ""}`}>
                      ⚖ {f.judge_verdict}（{(f.judge_confidence * 100).toFixed(0)}%）{f.judge_rationale}
                      {f.repair?.suggestion && <div>🔧 {f.repair.suggestion}</div>}
                      {f.repair?.classification && <div>📋 分类提议：{f.repair.classification}</div>}
                    </div>)}
                </td>
                <td style={{ width: 200 }}>
                  <button className="btn small" onClick={() => act(f.id, "accept")}>确认问题</button>
                  <button className="btn small" onClick={() => act(f.id, "dismiss")}>忽略</button>
                  {f.repair?.suggestion && (
                    <button className="btn small" onClick={() => act(f.id, "accept_repair")}>
                      采纳修复</button>)}
                </td>
              </tr>))}
          </tbody></table>
        </div>))}
    </>
  );
}
