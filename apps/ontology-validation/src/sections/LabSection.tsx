import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { Loader2 } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Card, CardHeader, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Table, Th, Td } from "../components/ui/Table";

export function LabSection() {
  const { dataset } = useStore();
  const [ops, setOps] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [matrix, setMatrix] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api("/api/datasets").then((d) => { setOps(d.operators); setSelected(new Set(d.operators.map((o: any) => o.op_id))); });
  }, []);

  useEffect(() => {
    if (!matrix || !chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    const layers = matrix.layers; const rows = matrix.rows;
    const data: any[] = [];
    rows.forEach((r: any, i: number) => layers.forEach((ly: string, j: number) =>
      data.push([j, i, r.captured.includes(ly) ? 2 : r.expected.includes(ly) ? 1 : 0])));
    chart.setOption({
      tooltip: { formatter: (p: any) => {
        const r = rows[p.value[1]];
        return `${r.description}<br/>${layers[p.value[0]]}：` +
          (p.value[2] === 2 ? "✓ 捕获" : p.value[2] === 1 ? "✗ 期望但漏报" : "—");
      } },
      grid: { left: 300, top: 8, right: 40, bottom: 36 },
      xAxis: { type: "category", data: layers,
               axisLabel: { color: "#475569", fontSize: 11 }, axisLine: { lineStyle: { color: "#cbd5e1" } } },
      yAxis: { type: "category", inverse: true, data: rows.map((r: any) => r.description),
               axisLabel: { fontSize: 11, color: "#475569" }, axisLine: { lineStyle: { color: "#cbd5e1" } } },
      visualMap: { min: 0, max: 2, show: false, inRange: { color: ["#f1f5f9", "#fecdd3", "#10b981"] } },
      series: [{ type: "heatmap", data, itemStyle: { borderColor: "#fff", borderWidth: 2 } }],
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => chart.resize());   // 侧栏开合等容器宽度变化
    ro.observe(chartRef.current);
    return () => { window.removeEventListener("resize", onResize); ro.disconnect(); chart.dispose(); };
  }, [matrix]);

  async function run() {
    setRunning(true);
    try { setMatrix(await api(`/api/mutations/run?dataset=${dataset}`, { method: "POST", body: JSON.stringify([...selected]) })); }
    finally { setRunning(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="变异算子" sub="注入已知错误 → 全管线重跑 → 看哪层抓住（⚖ 需 LLM judge）" />
        <CardBody className="px-0 pb-0">
          <Table>
            <thead><tr><Th></Th><Th>算子</Th><Th>对象</Th><Th>期望捕获</Th></tr></thead>
            <tbody>
              {ops.map((o) => (
                <tr key={o.op_id} className="hover:bg-[var(--surface-2)]">
                  <Td><input type="checkbox" checked={selected.has(o.op_id)} onChange={(e) => {
                    const s = new Set(selected); e.target.checked ? s.add(o.op_id) : s.delete(o.op_id); setSelected(s);
                  }} /></Td>
                  <Td>{o.description}{o.needs_judge && " ⚖"}</Td>
                  <Td className="text-[var(--fg-muted)]">{o.target}</Td>
                  <Td className="text-xs">{o.expected.length ? o.expected.join("+") : <span className="text-[var(--fg-subtle)]">（预期盲区）</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="p-4">
            <Button variant="primary" onClick={run} disabled={running}>
              {running ? <Loader2 size={15} className="animate-spin" /> : null}
              {running ? "注入并重跑中…" : "运行错误注入"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {matrix && (
        <Card>
          <CardHeader title="捕获率矩阵"
            sub="绿=捕获 · 红=期望但漏报 · 灰=无关；「删 disjoint」整行灰 = 管线盲区（可证伪质量证书）" />
          <CardBody>
            <div ref={chartRef} style={{ height: 30 * matrix.rows.length + 70 }} />
            <Table className="mt-2">
              <thead><tr><Th>算子</Th><Th>捕获层</Th><Th>符合预期</Th><Th>新增 findings</Th></tr></thead>
              <tbody>
                {matrix.rows.map((r: any) => (
                  <tr key={r.op_id} className="hover:bg-[var(--surface-2)]">
                    <Td>{r.description}</Td>
                    <Td className="mono text-xs">{r.captured.join("+") || (r.blind ? "全层漏报 ⚠" : "")}</Td>
                    <Td>{r.as_expected ? "✓" : "✗"}</Td>
                    <Td className="mono text-xs text-[var(--fg-subtle)]">{r.new_findings.map((f: any) => `${f.validator}:${f.type}`).join("; ").slice(0, 110)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
