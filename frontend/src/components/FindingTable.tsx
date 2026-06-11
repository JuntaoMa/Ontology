import { SEV_COLOR } from "../api";

export default function FindingTable({ findings }: { findings: any[] }) {
  if (!findings.length) return <div className="muted">无 findings</div>;
  return (
    <table>
      <thead><tr><th style={{width:80}}>severity</th><th>对象 / 内容</th></tr></thead>
      <tbody>
        {findings.map((f) => (
          <tr key={f.id}>
            <td><span className="badge" style={{ background: SEV_COLOR[f.severity] }}>
              {f.severity}</span><div className="muted">{f.finding_type}</div></td>
            <td>
              <div className="mono">{String(f.object_id).split("#").pop()}</div>
              <div>{f.message}</div>
              {f.judge_verdict && (
                <div className={`judge-box ${f.judge_verdict === "likely_false_positive" ? "fp" : ""}`}>
                  ⚖ judge：{f.judge_verdict}（{(f.judge_confidence * 100).toFixed(0)}%）
                  — {f.judge_rationale}
                  {f.repair?.suggestion && <div>🔧 修复建议：{f.repair.suggestion}</div>}
                  {f.repair?.classification && <div>📋 分类提议：{f.repair.classification}</div>}
                </div>)}
            </td>
          </tr>))}
      </tbody>
    </table>
  );
}
