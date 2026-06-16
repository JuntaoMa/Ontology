import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import { api } from "../api";
import { useStore } from "../store";
import { EmptyRun } from "../components/EmptyRun";
import { Card, CardHeader, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { FindingList } from "../components/FindingList";

export function OntologySection() {
  const { dataset, run, findings } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [showInstances, setShowInstances] = useState(false);

  const mine = (vids: string[]) => findings.filter((f) => vids.includes(f.validator_id));

  useEffect(() => {
    let cy: any;
    api(`/api/ontology/${dataset}/graph`).then((g) => {
      if (!ref.current) return;
      const violationIds = new Set(findings.filter((f) =>
        ["v2.shacl_minimal", "v2.shacl_trusted", "v1.consistency"].includes(f.validator_id))
        .map((f) => f.object_id));
      const pitfallIds = new Set(findings.filter((f) => f.validator_id === "v1.pitfalls")
        .map((f) => f.object_id));
      const j1Locals = new Set(findings.filter((f) => f.validator_id === "v5.j1")
        .flatMap((f) => { const m = String(f.object_id).match(/^axiom:(.+?)[⊑<]/); return m ? [m[1].trim()] : []; }));

      const nodes = g.nodes.filter((n: any) => showInstances || n.data.kind !== "individual");
      const visibleIds = new Set(nodes.map((n: any) => n.data.id));
      const edges = g.edges.filter((e: any) =>
        (showInstances || e.data.kind !== "type") &&
        visibleIds.has(e.data.source) && visibleIds.has(e.data.target));

      cy = cytoscape({
        container: ref.current,
        elements: [...nodes, ...edges],
        style: [
          // 节点：中性灰打底，标记色才饱和（违例红 > J1紫 > pitfall琥珀）
          { selector: 'node[kind="class"]', style: { label: "data(label)", shape: "round-rectangle",
              width: 70, height: 28, "background-color": "#f1f5f9", "border-width": 1,
              "border-color": "#cbd5e1", color: "#334155", "text-valign": "center",
              "text-halign": "center", "font-size": 10, "text-wrap": "wrap", "text-max-width": "66px" } },
          { selector: 'node[kind="individual"]', style: { label: "data(label)", shape: "ellipse",
              width: 12, height: 12, "background-color": "#cbd5e1", color: "#64748b",
              "font-size": 8, "text-margin-y": -2 } },
          // 边按 kind 分色：蓝实线=对象属性、灰实线=subClassOf、灰点线=rdf:type
          { selector: 'edge[kind="property"]', style: { width: 2, "curve-style": "bezier",
              "target-arrow-shape": "triangle", "line-color": "#6366f1", "target-arrow-color": "#6366f1",
              label: "data(label)", "font-size": 9, color: "#6366f1", "text-rotation": "autorotate",
              "text-background-color": "#fff", "text-background-opacity": 1, "text-background-padding": "1px" } },
          { selector: 'edge[kind="subclass"]', style: { width: 1.5, "curve-style": "bezier",
              "target-arrow-shape": "triangle", "arrow-scale": 0.8, "line-style": "solid",
              "line-color": "#94a3b8", "target-arrow-color": "#94a3b8",
              label: "subClassOf", "font-size": 8, color: "#94a3b8", "text-rotation": "autorotate" } },
          { selector: 'edge[kind="type"]', style: { width: 1, "curve-style": "bezier",
              "line-style": "dotted", "line-color": "#e2e8f0", "target-arrow-shape": "none" } },
        ],
        layout: { name: "cose", animate: false, padding: 20, nodeRepulsion: 9000, idealEdgeLength: 90 },
      });
      cy.nodes().forEach((n: any) => {
        const id = n.id(); const local = id.split("#").pop();
        const flag = (bg: string) => n.style({ "background-color": bg, color: "#fff", "border-width": 0 });
        if (violationIds.has(id)) flag("#e11d48");
        else if (j1Locals.has(local)) flag("#7c3aed");
        else if (pitfallIds.has(id)) flag("#d97706");
      });
    }).catch(() => {});
    return () => cy && cy.destroy();
  }, [dataset, findings, showInstances]);

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
        <CardHeader
          title="本体图谱"
          sub="蓝边=对象属性 · 灰边=subClassOf · 灰点线=实例。节点：灰=正常 · 红=违例 · 琥珀=结构pitfall · 紫=J1语义可疑"
          right={
            <Button size="sm" variant={showInstances ? "primary" : "outline"}
                    onClick={() => setShowInstances((v) => !v)}>
              {showInstances ? "隐藏实例" : "显示实例"}
            </Button>
          } />
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
