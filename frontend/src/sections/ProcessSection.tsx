import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import { api } from "../api";
import { useStore } from "../store";
import { EmptyRun } from "../components/EmptyRun";
import { Card, CardHeader, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Badge";
import { FindingList } from "../components/FindingList";

const VARIANTS = ["loan_normal", "loan_deadlock", "loan_dead_branch", "loan_rule_violation", "loan_edge_unfaithful"];

export function ProcessSection() {
  const { dataset, run, findings } = useStore();
  const [pid, setPid] = useState(VARIANTS[0]);
  const [desc, setDesc] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const mine = (vid: string) => findings.filter((f) => f.validator_id === vid && f.object_id === pid);
  const deadActs = new Set(mine("v4.simulation").map((f) => f.locus.activity));

  useEffect(() => {
    if (dataset !== "loan") return;
    let cy: any;
    api(`/api/process/${dataset}/${pid}`).then((d) => {
      setDesc(d.ir.description || "");
      if (!ref.current) return;
      cy = cytoscape({
        container: ref.current,
        elements: [...d.graph.nodes, ...d.graph.edges],
        style: [
          { selector: "node", style: { label: "data(label)", "font-size": 10, shape: "round-rectangle",
              width: 84, height: 30, "background-color": "#4f46e5", color: "#fff", "text-valign": "center",
              "text-halign": "center", "text-wrap": "wrap", "text-max-width": "80px" } },
          { selector: 'node[kind="gateway_XOR"]', style: { shape: "diamond", "background-color": "#d97706", width: 38, height: 38 } },
          { selector: 'node[kind="gateway_AND"]', style: { shape: "diamond", "background-color": "#e11d48", width: 38, height: 38 } },
          { selector: "edge", style: { width: 1.5, "curve-style": "bezier", "target-arrow-shape": "triangle",
              "line-color": "#cbd5e1", "target-arrow-color": "#cbd5e1", label: "data(label)",
              "font-size": 8, color: "#94a3b8", "text-rotation": "autorotate" } },
        ],
        layout: { name: "breadthfirst", directed: true, spacingFactor: 1.1, animate: false },
      });
      cy.nodes().forEach((n: any) => { if (deadActs.has(n.id())) n.style({ "background-color": "#94a3b8" }); });
    }).catch(() => {});
    return () => cy && cy.destroy();
  }, [dataset, pid, findings]);

  if (!run) return <EmptyRun />;
  if (dataset !== "loan") return <div className="text-sm text-[var(--fg-subtle)]">流程校验仅 loan 数据集提供。</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {VARIANTS.map((v) => (
          <Button key={v} size="sm" variant={v === pid ? "primary" : "outline"} onClick={() => setPid(v)}>
            {v.replace("loan_", "")}
          </Button>
        ))}
        {desc && <span className="text-xs text-[var(--fg-subtle)]">{desc}</span>}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="流程图" sub="橙菱=XOR · 红菱=AND · 灰=数据不可达活动" />
          <CardBody><div ref={ref} className="h-[480px] rounded-[var(--radius-sm)] border border-[var(--border)]" /></CardBody>
        </Card>
        <div className="flex flex-col gap-4">
          <Card><CardHeader title="V4 形式化（soundness）" /><CardBody className="pt-0"><FindingList findings={mine("v4.formal")} empty="健全，无问题" dataset={dataset} /></CardBody></Card>
          <Card><CardHeader title="V4 仿真（数据感知覆盖率）" /><CardBody className="pt-0"><FindingList findings={mine("v4.simulation")} empty="活动全覆盖" dataset={dataset} /></CardBody></Card>
          <Card>
            <CardHeader title="V3×V4 交叉验证环" sub="违例回链来源规则" />
            <CardBody className="flex flex-col gap-2 pt-0">
              {mine("v4.cross").length === 0 && <div className="text-xs text-[var(--fg-subtle)]">无交叉违例</div>}
              {mine("v4.cross").map((f) => (
                <div key={f.id} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2.5 text-[13px]">
                  <div>{f.message}</div>
                  <div className="mono mt-1 text-xs text-[var(--fg-subtle)]">样例 case：{JSON.stringify(f.locus.sample_case?.data)}</div>
                  <div className="mono text-xs text-[var(--fg-subtle)]">trace：{f.locus.sample_case?.activities?.join(" → ")}</div>
                  <div className="mt-1 text-xs text-[var(--fg-subtle)]">规则原文：「{f.evidence?.rule_quote}」</div>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="V5 J2 边忠实性" sub="IR 方向 vs 原文" right={<Pill tone="accent">advise</Pill>} />
            <CardBody className="pt-0"><FindingList findings={findings.filter((f) => f.validator_id === "v5.j2" && f.object_id === pid)} empty="无忠实性问题" dataset={dataset} /></CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
