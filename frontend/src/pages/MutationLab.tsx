import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { api, LAYER_NAME } from "../api";

export default function MutationLab({ dataset }: any) {
  const [ops, setOps] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [matrix, setMatrix] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api("/api/datasets").then((d) => {
      setOps(d.operators);
      setSelected(new Set(d.operators.map((o: any) => o.op_id)));
    });
  }, []);

  useEffect(() => {
    if (!matrix || !chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    const layers = matrix.layers;
    const rows = matrix.rows;
    const data: any[] = [];
    rows.forEach((r: any, i: number) => layers.forEach((ly: string, j: number) => {
      const captured = r.captured.includes(ly);
      const expected = r.expected.includes(ly);
      data.push([j, i, captured ? 2 : expected ? 1 : 0]);
    }));
    chart.setOption({
      tooltip: { formatter: (p: any) => {
        const r = rows[p.value[1]];
        return `${r.description}<br/>层 ${layers[p.value[0]]}：` +
          (p.value[2] === 2 ? "✓ 捕获" : p.value[2] === 1 ? "✗ 期望但漏报" : "—");
      }},
      grid: { left: 280, top: 10, right: 60, bottom: 40 },
      xAxis: { type: "category", data: layers.map((l: string) => LAYER_NAME[l]) },
      yAxis: { type: "category", inverse: true,
               data: rows.map((r: any) => r.description), axisLabel: { fontSize: 11 } },
      visualMap: { min: 0, max: 2, show: false,
                   inRange: { color: ["#f5f5f5", "#ffccc7", "#52c41a"] } },
      series: [{ type: "heatmap", data, label: { show: false } }],
    });
    return () => chart.dispose();
  }, [matrix]);

  async function run() {
    setRunning(true);
    try {
      setMatrix(await api(`/api/mutations/run?dataset=${dataset}`, {
        method: "POST", body: JSON.stringify([...selected]) }));
    } finally { setRunning(false); }
  }

  return (
    <>
      <div className="panel">
        <h3>变异算子（注入已知错误 → 全管线重跑 → 看哪层抓住）</h3>
        <table>
          <thead><tr><th></th><th>算子</th><th>对象</th><th>期望捕获</th></tr></thead>
          <tbody>
            {ops.map((o) => (
              <tr key={o.op_id}>
                <td><input type="checkbox" checked={selected.has(o.op_id)}
                  onChange={(e) => {
                    const s = new Set(selected);
                    e.target.checked ? s.add(o.op_id) : s.delete(o.op_id);
                    setSelected(s);
                  }} /></td>
                <td>{o.description}{o.needs_judge && " ⚖"}</td>
                <td>{o.target}</td>
                <td>{o.expected.length ? o.expected.join("+") : "（预期盲区）"}</td>
              </tr>))}
          </tbody>
        </table>
        <div style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={run} disabled={running}>
            {running ? "注入并重跑中…" : "▶ 运行错误注入"}</button>
          <span className="muted">⚖ 标记的算子需要 LLM judge（走缓存/cassette 或真实后端）</span>
        </div>
      </div>
      {matrix && (
        <div className="panel">
          <h3>捕获率矩阵（绿=捕获，红=期望但漏报，灰=无关）——「删 disjoint」整行灰即管线盲区</h3>
          <div ref={chartRef} style={{ height: 30 * matrix.rows.length + 80 }} />
          <table>
            <thead><tr><th>算子</th><th>捕获层</th><th>符合预期</th><th>新增 findings</th></tr></thead>
            <tbody>
              {matrix.rows.map((r: any) => (
                <tr key={r.op_id}>
                  <td>{r.description}</td>
                  <td>{r.captured.join("+") || (r.blind ? "全层漏报 ⚠" : "")}</td>
                  <td>{r.as_expected ? "✓" : "✗"}</td>
                  <td className="mono muted">{r.new_findings.map((f: any) =>
                    `${f.validator}:${f.type}`).join("; ").slice(0, 120)}</td>
                </tr>))}
            </tbody>
          </table>
        </div>)}
    </>
  );
}
