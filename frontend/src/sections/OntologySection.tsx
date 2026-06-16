import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import { api } from "../api";
import { useStore } from "../store";
import { EmptyRun } from "../components/EmptyRun";
import { Card, CardHeader, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { FindingList } from "../components/FindingList";

/** 确定性力导向：按 id 哈希给每个节点一个固定的初始位置（种子），再跑 cose 的
 *  randomize:false（力导向但不引入随机）。结果是力导向的自然散布，且同一视图每次刷新一致。 */
function seedPositions(nodes: any[]) {
  const sorted = [...nodes].sort((a, b) => a.data.id.localeCompare(b.data.id));
  const n = Math.max(sorted.length, 1);
  const R = 60 + n * 14;
  sorted.forEach((node, i) => {
    // 黄金角螺旋铺开（确定性），给 cose 一个均匀的起点，避免初始重叠
    const a = i * 2.399963;            // 黄金角
    const r = R * Math.sqrt((i + 0.5) / n);
    node.position = { x: 400 + r * Math.cos(a), y: 320 + r * Math.sin(a) };
  });
}

const SWATCH = [
  { c: "#94a3b8", t: "正常" }, { c: "#e11d48", t: "违例" },
  { c: "#d97706", t: "结构 pitfall" }, { c: "#7c3aed", t: "J1 语义可疑" },
];
const LINES = [
  { c: "#6366f1", t: "对象属性", d: false }, { c: "#94a3b8", t: "subClassOf", d: false },
  { c: "#cbd5e1", t: "实例", d: true },
];

export function OntologySection() {
  const { dataset, run, findings } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const [showInstances, setShowInstances] = useState(false);

  const mine = (vids: string[]) => findings.filter((f) => vids.includes(f.validator_id));

  // 容器尺寸变化（侧栏开合、窗口缩放）→ 重新适配图谱
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(() => {
      const cy = cyRef.current;
      if (cy) requestAnimationFrame(() => { cy.resize(); cy.fit(undefined, 28); });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

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

      const nodes = g.nodes.filter((n: any) => showInstances || n.data.kind !== "individual")
        .map((n: any) => ({ data: n.data }));
      const visibleIds = new Set(nodes.map((n: any) => n.data.id));
      const edges = g.edges.filter((e: any) =>
        (showInstances || e.data.kind !== "type") &&
        visibleIds.has(e.data.source) && visibleIds.has(e.data.target));
      seedPositions(nodes);

      cy = cytoscape({
        container: ref.current,
        elements: [...nodes, ...edges],
        // 确定性力导向：种子初始位置 + randomize:false → 刷新结果一致
        layout: { name: "cose", randomize: false, animate: false, fit: true, padding: 28,
                  nodeRepulsion: 9000, idealEdgeLength: 80, edgeElasticity: 120,
                  gravity: 0.3, componentSpacing: 90, numIter: 1200,
                  nodeDimensionsIncludeLabels: true },
        style: [
          { selector: 'node[kind="class"]', style: { label: "data(label)", shape: "round-rectangle",
              width: 70, height: 28, "background-color": "#f1f5f9", "border-width": 1,
              "border-color": "#cbd5e1", color: "#334155", "text-valign": "center",
              "text-halign": "center", "font-size": 10, "text-wrap": "wrap", "text-max-width": "66px" } },
          { selector: 'node[kind="individual"]', style: { label: "data(label)", shape: "ellipse",
              width: 11, height: 11, "background-color": "#cbd5e1", color: "#94a3b8",
              "font-size": 7, "text-margin-y": -1 } },
          { selector: 'edge[kind="property"]', style: { width: 2, "curve-style": "bezier",
              "target-arrow-shape": "triangle", "line-color": "#6366f1", "target-arrow-color": "#6366f1",
              label: "data(label)", "font-size": 9, color: "#6366f1", "text-rotation": "autorotate",
              "text-background-color": "#fff", "text-background-opacity": 1, "text-background-padding": "1px" } },
          { selector: 'edge[kind="subclass"]', style: { width: 1.5, "curve-style": "bezier",
              "target-arrow-shape": "triangle", "arrow-scale": 0.8, "line-color": "#94a3b8",
              "target-arrow-color": "#94a3b8", label: "subClassOf", "font-size": 8, color: "#94a3b8",
              "text-rotation": "autorotate" } },
          { selector: 'edge[kind="type"]', style: { width: 1, "curve-style": "bezier",
              "line-style": "dotted", "line-color": "#e2e8f0", "target-arrow-shape": "none" } },
        ],
      });
      cy.nodes().forEach((n: any) => {
        const id = n.id(); const local = id.split("#").pop();
        const flag = (bg: string) => n.style({ "background-color": bg, color: "#fff", "border-width": 0 });
        if (violationIds.has(id)) flag("#e11d48");
        else if (j1Locals.has(local)) flag("#7c3aed");
        else if (pitfallIds.has(id)) flag("#d97706");
      });
      cyRef.current = cy;
      requestAnimationFrame(() => { cy.resize(); cy.fit(undefined, 28); });
    }).catch(() => {});
    return () => { if (cy) { cy.destroy(); cyRef.current = null; } };
  }, [dataset, findings, showInstances]);

  if (!run) return <EmptyRun />;

  const groups: [string, string[]][] = [
    ["V2 SHACL（minimal=veto / trusted=score）", ["v2.shacl_minimal", "v2.shacl_trusted"]],
    ["V1 推理一致性 + pitfall", ["v1.consistency", "v1.pitfalls"]],
    ["V1 CQ 回归（J3 提议分类待人工确认）", ["v1.cq"]],
    ["V5 J1 语义合理性（advise · 紫色高亮）", ["v5.j1"]],
  ];

  return (
    <div className="flex h-full gap-4 p-5">
      {/* 左：图谱，高度填满、不随页面滚动 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Card className="flex h-full flex-col">
          <CardHeader title="本体图谱" right={
            <Button size="sm" variant={showInstances ? "primary" : "outline"}
                    onClick={() => setShowInstances((v) => !v)}>
              {showInstances ? "隐藏实例" : "显示实例"}
            </Button>
          } />
          <CardBody className="relative min-h-0 flex-1 pb-4">
            <div ref={ref} className="h-full w-full rounded-[var(--radius-sm)] border border-[var(--border)]" />
            {/* 画布内嵌图例：色块本身就是图例，不用文字描述颜色 */}
            <div className="absolute bottom-6 left-6 z-10 rounded-md border border-[var(--border)] bg-white/90 px-2.5 py-1.5 backdrop-blur-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--fg-muted)]">
                {SWATCH.map((s) => (
                  <span key={s.t} className="inline-flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.c }} /> {s.t}
                  </span>
                ))}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-[var(--fg-muted)]">
                {LINES.map((l) => (
                  <span key={l.t} className="inline-flex items-center gap-1">
                    <span className="inline-block h-0 w-4"
                          style={{ borderTop: `2px ${l.d ? "dotted" : "solid"} ${l.c}` }} /> {l.t}
                  </span>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
      {/* 右：校验结果，独立滚动 */}
      <div className="flex w-[380px] shrink-0 flex-col gap-4 overflow-auto pr-1">
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
