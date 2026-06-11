import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import { api } from "../api";
import FindingTable from "../components/FindingTable";

const VARIANTS = ["loan_normal", "loan_deadlock", "loan_dead_branch",
                  "loan_rule_violation", "loan_edge_unfaithful"];

export default function Process({ dataset, findings }: any) {
  const [pid, setPid] = useState(VARIANTS[0]);
  const [ir, setIr] = useState<any>(null);
  const ref = useRef<HTMLDivElement>(null);

  const mine = (vid: string) =>
    findings.filter((f: any) => f.validator_id === vid && f.object_id === pid);
  const deadActs = new Set(mine("v4.simulation").map((f: any) => f.locus.activity));

  useEffect(() => {
    if (dataset !== "loan") { setIr(null); return; }
    let cy: any;
    api(`/api/process/${dataset}/${pid}`).then((d) => {
      setIr(d.ir);
      if (!ref.current) return;
      cy = cytoscape({
        container: ref.current,
        elements: [...d.graph.nodes, ...d.graph.edges],
        style: [
          { selector: "node", style: { label: "data(label)", "font-size": 10,
              shape: "round-rectangle", width: 80, height: 30,
              "background-color": "#1677ff", color: "#fff",
              "text-valign": "center", "text-halign": "center", "text-wrap": "wrap",
              "text-max-width": "76px" } },
          { selector: 'node[kind="gateway_XOR"]', style: { shape: "diamond",
              "background-color": "#fa8c16", width: 36, height: 36 } },
          { selector: 'node[kind="gateway_AND"]', style: { shape: "diamond",
              "background-color": "#cf1322", width: 36, height: 36 } },
          { selector: "edge", style: { width: 1.5, "curve-style": "bezier",
              "target-arrow-shape": "triangle", "line-color": "#bfbfbf",
              "target-arrow-color": "#bfbfbf", label: "data(label)",
              "font-size": 8, color: "#8c8c8c", "text-rotation": "autorotate" } },
        ],
        layout: { name: "breadthfirst", directed: true, spacingFactor: 1.1, animate: false },
      });
      cy.nodes().forEach((n: any) => {
        if (deadActs.has(n.id())) n.style({ "background-color": "#8c8c8c" });
      });
    });
    return () => cy && cy.destroy();
  }, [dataset, pid, findings]);

  if (dataset !== "loan") return <div className="panel">流程校验仅 loan 数据集提供。</div>;
  const simMetrics = null; // 指标在 finding 中呈现

  return (
    <>
      <div className="panel">
        {VARIANTS.map((v) => (
          <button key={v} className={`btn ${v === pid ? "primary" : ""}`}
                  onClick={() => setPid(v)}>{v.replace("loan_", "")}</button>
        ))}
        {ir && <span className="muted">{ir.description}</span>}
      </div>
      <div className="row">
        <div className="col panel">
          <h3>流程图（橙菱形=XOR，红菱形=AND，灰=数据不可达活动）</h3>
          <div className="graph" ref={ref} />
        </div>
        <div className="col">
          <div className="panel"><h3>V4 形式化（soundness）</h3>
            <FindingTable findings={mine("v4.formal")} /></div>
          <div className="panel"><h3>V4 仿真（数据感知覆盖率）</h3>
            <FindingTable findings={mine("v4.simulation")} /></div>
          <div className="panel"><h3>V3×V4 交叉验证环（违例回链规则）</h3>
            {mine("v4.cross").map((f: any) => (
              <div key={f.id} style={{ marginBottom: 8 }}>
                <div>{f.message}</div>
                <div className="mono muted">样例 case：{JSON.stringify(f.locus.sample_case?.data)}</div>
                <div className="mono muted">trace：{f.locus.sample_case?.activities?.join(" → ")}</div>
                <div className="muted">规则原文：「{f.evidence?.rule_quote}」</div>
              </div>))}
            {!mine("v4.cross").length && <div className="muted">无违例</div>}
          </div>
          <div className="panel"><h3>V5 J2 边忠实性（IR 方向 vs 原文）</h3>
            <FindingTable findings={findings.filter((f: any) =>
              f.validator_id === "v5.j2" && f.object_id === pid)} /></div>
        </div>
      </div>
    </>
  );
}
