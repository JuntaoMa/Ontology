import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import { api, SEV_COLOR } from "../api";
import FindingTable from "../components/FindingTable";

export default function Ontology({ dataset, findings }: any) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cy: any;
    api(`/api/ontology/${dataset}/graph`).then((g) => {
      if (!ref.current) return;
      const badIds = new Set(
        findings.filter((f: any) => ["v2.shacl_minimal", "v2.shacl_trusted", "v1.consistency"]
          .includes(f.validator_id)).map((f: any) => f.object_id));
      const j1Ids = new Set(
        findings.filter((f: any) => f.validator_id === "v5.j1")
          .flatMap((f: any) => {
            const m = f.object_id.match(/^axiom:(.+)⊑/);
            return m ? [m[1]] : [];
          }));
      cy = cytoscape({
        container: ref.current,
        elements: [...g.nodes, ...g.edges],
        style: [
          { selector: "node", style: { label: "data(label)", "font-size": 9,
              width: 18, height: 18, "background-color": "#91caff" } },
          { selector: 'node[kind="class"]', style: { shape: "round-rectangle",
              width: 60, height: 24, "background-color": "#1677ff", color: "#fff",
              "text-valign": "center", "text-halign": "center" } },
          { selector: "edge", style: { width: 1, "curve-style": "bezier",
              "target-arrow-shape": "triangle", "arrow-scale": 0.7,
              "line-color": "#d9d9d9", "target-arrow-color": "#d9d9d9",
              label: "data(label)", "font-size": 7, color: "#bfbfbf" } },
        ],
        layout: { name: "cose", animate: false },
      });
      cy.nodes().forEach((n: any) => {
        const id = n.id();
        const local = id.split("#").pop();
        if (badIds.has(id)) n.style({ "background-color": "#d4380d", color: "#fff" });
        if (j1Ids.has(local)) n.style({ "background-color": "#722ed1", color: "#fff" });
      });
    });
    return () => cy && cy.destroy();
  }, [dataset, findings]);

  const groups = [
    ["V2 SHACL（minimal=veto / trusted=score）", ["v2.shacl_minimal", "v2.shacl_trusted"]],
    ["V1 推理一致性 + pitfall", ["v1.consistency", "v1.pitfalls"]],
    ["V1 CQ 回归（J3 提议分类待人工确认）", ["v1.cq"]],
    ["V5 J1 语义合理性（advise，紫色高亮）", ["v5.j1"]],
  ] as const;

  return (
    <div className="row">
      <div className="col panel">
        <h3>本体图谱（红=确定性违例，紫=J1 语义可疑）</h3>
        <div className="graph" ref={ref} />
      </div>
      <div className="col">
        {groups.map(([title, vids]) => (
          <div className="panel" key={title}>
            <h3>{title}</h3>
            <FindingTable findings={findings.filter((f: any) => vids.includes(f.validator_id))} />
          </div>
        ))}
      </div>
    </div>
  );
}
