import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import { api } from "../api";
import { useStore } from "../store";
import { EmptyRun } from "../components/EmptyRun";
import { Card, CardHeader, CardBody } from "../components/ui/Card";
import { FindingList } from "../components/FindingList";

export function OntologySection() {
  const { dataset, run, findings } = useStore();
  const ref = useRef<HTMLDivElement>(null);

  const mine = (vids: string[]) => findings.filter((f) => vids.includes(f.validator_id));

  useEffect(() => {
    let cy: any;
    api(`/api/ontology/${dataset}/graph`).then((g) => {
      if (!ref.current) return;
      const badIds = new Set(
        findings.filter((f) => ["v2.shacl_minimal", "v2.shacl_trusted", "v1.consistency"]
          .includes(f.validator_id)).map((f) => f.object_id));
      const j1Locals = new Set(
        findings.filter((f) => f.validator_id === "v5.j1")
          .flatMap((f) => { const m = String(f.object_id).match(/^axiom:(.+)⊑/); return m ? [m[1]] : []; }));
      cy = cytoscape({
        container: ref.current,
        elements: [...g.nodes, ...g.edges],
        style: [
          { selector: "node", style: { label: "data(label)", "font-size": 9, color: "#475569",
              width: 16, height: 16, "background-color": "#cbd5e1", "text-margin-y": -2 } },
          { selector: 'node[kind="class"]', style: { shape: "round-rectangle", width: 64, height: 24,
              "background-color": "#4f46e5", color: "#fff", "text-valign": "center",
              "text-halign": "center", "font-size": 9 } },
          { selector: "edge", style: { width: 1, "curve-style": "bezier", "target-arrow-shape": "triangle",
              "arrow-scale": 0.7, "line-color": "#e2e8f0", "target-arrow-color": "#cbd5e1",
              label: "data(label)", "font-size": 7, color: "#cbd5e1" } },
        ],
        layout: { name: "cose", animate: false },
      });
      cy.nodes().forEach((n: any) => {
        const id = n.id(); const local = id.split("#").pop();
        if (badIds.has(id)) n.style({ "background-color": "#e11d48", color: "#fff" });
        if (j1Locals.has(local)) n.style({ "background-color": "#7c3aed", color: "#fff" });
      });
    }).catch(() => {});
    return () => cy && cy.destroy();
  }, [dataset, findings]);

  if (!run) return <EmptyRun />;

  const groups: [string, string[]][] = [
    ["V2 SHACL（minimal=veto / trusted=score）", ["v2.shacl_minimal", "v2.shacl_trusted"]],
    ["V1 推理一致性 + pitfall", ["v1.consistency", "v1.pitfalls"]],
    ["V1 CQ 回归（J3 提议分类待人工确认）", ["v1.cq"]],
    ["V5 J1 语义合理性（advise · 紫色高亮）", ["v5.j1"]],
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="本体图谱" sub="红=确定性违例 · 紫=J1 语义可疑" />
        <CardBody><div ref={ref} className="h-[520px] rounded-[var(--radius-sm)] border border-[var(--border)]" /></CardBody>
      </Card>
      <div className="flex flex-col gap-4">
        {groups.map(([title, vids]) => (
          <Card key={title}>
            <CardHeader title={title} />
            <CardBody className="pt-0"><FindingList findings={mine(vids)} dataset={dataset} /></CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
