import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import { api, type RunSummary } from "../api";
import { useStore } from "../store";
import { LAYER_NAME } from "../lib/semantics";
import { ValidatorCatalog } from "./ValidatorCatalog";

const LABEL: Record<string, string> = {
  "v0.structure": "结构校验", "v2.shacl_minimal": "最低 shape", "v2.shacl_trusted": "可信 shape",
  "v1.consistency": "推理一致性", "v1.pitfalls": "pitfall 扫描", "v1.cq": "CQ 回归",
  "v3.rules": "规则缺陷", "v4.formal": "soundness", "v4.simulation": "数据仿真",
  "v4.cross": "规则×流程环", "v5.j1": "J1 语义", "v5.j2": "J2 忠实性", "v5.j3": "J3 复判",
};
const FILL: Record<string, string> = {
  pass: "#ecfdf5", fail: "#fff1f2", ambiguous: "#fffbeb", skip: "#f1f5f9", none: "#f8fafc",
};
const TEXT: Record<string, string> = {
  pass: "#047857", fail: "#be123c", ambiguous: "#b45309", skip: "#94a3b8", none: "#475569",
};
const AUTH_BORDER: Record<string, string> = { veto: "#b91c1c", score: "#cbd5e1", advise: "#7c3aed" };

export function DagView({ run }: { run: RunSummary | null }) {
  const { dataset, findings } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const [dag, setDag] = useState<any>(null);
  const [specs, setSpecs] = useState<Record<string, any> | null>(null);
  const [err, setErr] = useState(false);
  const [sel, setSel] = useState<any>(null);

  useEffect(() => {
    api("/api/pipeline/dag").then(setDag).catch(() => setErr(true));
  }, []);
  useEffect(() => { api(`/api/validators/${dataset}`).then(setSpecs).catch(() => {}); }, [dataset]);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(() => {
      const cy = cyRef.current;
      if (cy) requestAnimationFrame(() => { cy.resize(); cy.fit(undefined, 24); });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!dag || !ref.current) return;
    const nodes = dag.nodes as any[];
    const verdict: Record<string, string> = {};
    const quar: Record<string, number> = {};
    (run?.validators || []).forEach((v) => { verdict[v.validator_id] = v.verdict; });
    (run?.quarantine || []).forEach((q) => { quar[q.reason] = (quar[q.reason] || 0) + 1; });

    // 分层位置：depth = 最长依赖链；同层按 id 排序、竖直居中
    const deps: Record<string, string[]> = {};
    nodes.forEach((n) => { deps[n.id] = n.depends_on; });
    const memo: Record<string, number> = {};
    const depth = (id: string): number => {
      if (id in memo) return memo[id];
      const d = deps[id] || [];
      return (memo[id] = d.length ? 1 + Math.max(...d.map(depth)) : 0);
    };
    const cols: Record<number, any[]> = {};
    nodes.forEach((n) => { (cols[depth(n.id)] ||= []).push(n); });
    const maxRows = Math.max(...Object.values(cols).map((c) => c.length));
    const COL = 190, ROW = 64;
    const pos: Record<string, { x: number; y: number }> = {};
    Object.keys(cols).map(Number).forEach((d) => {
      const col = cols[d].sort((a, b) => a.id.localeCompare(b.id));
      const y0 = ((maxRows - col.length) * ROW) / 2;
      col.forEach((n, i) => { pos[n.id] = { x: d * COL + 80, y: y0 + i * ROW + 40 }; });
    });

    const elements: any[] = [];
    nodes.forEach((n) => {
      elements.push({ data: { id: n.id, label: LABEL[n.id] || n.id }, position: pos[n.id] });
    });
    nodes.forEach((n) => n.depends_on.forEach((d: string) =>
      elements.push({ data: { source: d, target: n.id } })));

    const cy = cytoscape({
      container: ref.current,
      elements,
      layout: { name: "preset", fit: true, padding: 26 },
      style: [
        { selector: "node", style: {
            label: "data(label)", shape: "round-rectangle", width: 98, height: 40,
            "background-color": "#f8fafc", color: "#475569",
            "border-width": 1, "border-color": "#cbd5e1",
            "text-valign": "center", "text-halign": "center", "font-size": 11,
            "text-wrap": "wrap", "text-max-width": "90px" } },
        { selector: "edge", style: { width: 1.5, "curve-style": "bezier",
            "target-arrow-shape": "triangle", "arrow-scale": 0.85,
            "line-color": "#cbd5e1", "target-arrow-color": "#94a3b8" } },
      ],
    });

    // 逐节点上色：填充=verdict、边框=authority、汇聚节点蓝粗框、quarantine 角标
    cy.nodes().forEach((node: any) => {
      const n = nodes.find((x) => x.id === node.id())!;
      const v = run ? (verdict[n.id] || "skip") : "none";
      const conv = n.depends_on.length >= 2;
      const label = (LABEL[n.id] || n.id) + (quar[n.id] ? `\n⊘${quar[n.id]}` : "");
      node.style({
        label,
        "background-color": FILL[v], color: TEXT[v],
        "border-width": conv ? 3 : n.authority === "veto" ? 2.5 : n.authority === "advise" ? 2 : 1,
        "border-color": conv ? "#4f46e5" : AUTH_BORDER[n.authority],
        "border-style": n.authority === "advise" && !conv ? "dashed" : "solid",
      });
    });

    cy.on("tap", "node", (e: any) => {
      const id = e.target.id();
      const n = nodes.find((x) => x.id === id)!;
      setSel({ id, label: LABEL[id] || id, layer: LAYER_NAME[n.layer], auth: n.authority,
               v: run?.validators.find((x) => x.validator_id === id) });
    });
    cy.on("tap", (e: any) => { if (e.target === cy) setSel(null); });
    cyRef.current = cy;
    requestAnimationFrame(() => { cy.resize(); cy.fit(undefined, 26); });
    return () => { cy.destroy(); cyRef.current = null; };
  }, [dag, run]);

  if (err) return (
    <div className="flex h-[200px] items-center justify-center text-center text-sm text-[var(--fg-subtle)]">
      无法加载流水线 DAG（/api/pipeline/dag）。<br />请确认后端已重启以提供该端点。
    </div>
  );

  return (
    <div>
      <div ref={ref} className="h-[320px] w-full rounded-[var(--radius-sm)] border border-[var(--border)]" />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--fg-muted)]">
        <span className="font-medium">填充=结果</span>
        {[["pass", "通过"], ["fail", "发现问题"], ["skip", "跳过"]].map(([k, t]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded" style={{ background: FILL[k], border: `1px solid ${TEXT[k]}` }} /> {t}
          </span>
        ))}
        <span className="ml-2 font-medium">边框=权限</span>
        {[["veto", "veto 否决"], ["score", "score 负证据"], ["advise", "advise LLM"]].map(([k, t]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-4 rounded"
                  style={{ border: `2px ${k === "advise" ? "dashed" : "solid"} ${AUTH_BORDER[k]}` }} /> {t}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded" style={{ border: "3px solid #4f46e5" }} /> 汇聚节点
        </span>
      </div>
      {sel && (
        <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs">
          <div>
            <span className="mono font-semibold">{sel.id}</span> · {sel.label} · {sel.layer} · 权限 {sel.auth}
            {sel.v && <> · verdict <b>{sel.v.verdict}</b>{sel.v.cached ? "（缓存）" : ""} · {sel.v.duration_ms}ms</>}
          </div>
          <div className="mt-2 border-t border-[var(--border)] pt-2">
            <ValidatorCatalog specs={specs} validatorIds={[sel.id]} findings={findings} />
          </div>
        </div>
      )}
    </div>
  );
}
