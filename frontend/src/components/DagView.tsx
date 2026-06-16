import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import { api, type RunSummary } from "../api";
import { LAYER_NAME } from "../lib/semantics";

const LABEL: Record<string, string> = {
  "v0.structure": "结构校验", "v2.shacl_minimal": "最低 shape", "v2.shacl_trusted": "可信 shape",
  "v1.consistency": "推理一致性", "v1.pitfalls": "pitfall 扫描", "v1.cq": "CQ 回归",
  "v3.rules": "规则缺陷", "v4.formal": "soundness", "v4.simulation": "数据仿真",
  "v4.cross": "规则×流程环", "v5.j1": "J1 语义", "v5.j2": "J2 忠实性", "v5.j3": "J3 复判",
};

// 节点填充 = verdict（结果），边框 = authority（权限）——双轴分通道
const VERDICT_FILL: Record<string, string> = {
  pass: "#ecfdf5", fail: "#fff1f2", ambiguous: "#fffbeb", skip: "#f1f5f9", none: "#f8fafc",
};
const VERDICT_TEXT: Record<string, string> = {
  pass: "#047857", fail: "#be123c", ambiguous: "#b45309", skip: "#94a3b8", none: "#475569",
};
const AUTH_BORDER: Record<string, string> = {
  veto: "#b91c1c", score: "#cbd5e1", advise: "#7c3aed",
};

export function DagView({ run }: { run: RunSummary | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const [dag, setDag] = useState<any>(null);
  const [sel, setSel] = useState<any>(null);

  useEffect(() => { api("/api/pipeline/dag").then(setDag).catch(() => {}); }, []);

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

    // 分层位置：depth = 最长依赖链长度；同层按 id 排序、竖直居中
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
    const COL = 188, ROW = 62;
    const pos: Record<string, { x: number; y: number }> = {};
    Object.keys(cols).map(Number).forEach((d) => {
      const col = cols[d].sort((a, b) => a.id.localeCompare(b.id));
      const y0 = ((maxRows - col.length) * ROW) / 2;
      col.forEach((n, i) => { pos[n.id] = { x: d * COL + 70, y: y0 + i * ROW + 36 }; });
    });

    const elements: any[] = [];
    nodes.forEach((n) => {
      const inDeg = n.depends_on.length;
      elements.push({ data: {
        id: n.id, label: LABEL[n.id] || n.id,
        layer: LAYER_NAME[n.layer], v: run ? (verdict[n.id] || "skip") : "none",
        auth: n.authority, conv: inDeg >= 2 ? "1" : "0",
        q: quar[n.id] ? `⊘${quar[n.id]}` : "" }, position: pos[n.id] });
    });
    nodes.forEach((n) => n.depends_on.forEach((d: string) =>
      elements.push({ data: { source: d, target: n.id } })));

    const cy = cytoscape({
      container: ref.current,
      elements,
      layout: { name: "preset", fit: true, padding: 24 },
      style: [
        { selector: "node", style: {
            label: "data(label)", shape: "round-rectangle", width: 96, height: 38,
            "background-color": (e: any) => VERDICT_FILL[e.data("v")],
            color: (e: any) => VERDICT_TEXT[e.data("v")],
            "border-width": (e: any) => (e.data("auth") === "veto" ? 2.5 : e.data("auth") === "advise" ? 2 : 1),
            "border-color": (e: any) => AUTH_BORDER[e.data("auth")],
            "border-style": (e: any) => (e.data("auth") === "advise" ? "dashed" : "solid"),
            "text-valign": "center", "text-halign": "center", "font-size": 11,
            "text-wrap": "wrap", "text-max-width": "88px" } },
        { selector: 'node[conv="1"]', style: { "border-width": 3, "border-color": "#4f46e5" } },
        { selector: "edge", style: { width: 1.5, "curve-style": "bezier",
            "target-arrow-shape": "triangle", "arrow-scale": 0.85,
            "line-color": "#cbd5e1", "target-arrow-color": "#94a3b8" } },
      ],
    });
    // quarantine 角标
    cy.nodes().forEach((n: any) => {
      if (n.data("q")) n.style({ label: `${n.data("label")}\n${n.data("q")}` });
    });
    cy.on("tap", "node", (e: any) => {
      const id = e.target.id();
      const v = run?.validators.find((x) => x.validator_id === id);
      setSel({ id, label: LABEL[id] || id, layer: e.target.data("layer"),
               auth: e.target.data("auth"), v });
    });
    cy.on("tap", (e: any) => { if (e.target === cy) setSel(null); });
    cyRef.current = cy;
    requestAnimationFrame(() => { cy.resize(); cy.fit(undefined, 24); });
    return () => { cy.destroy(); cyRef.current = null; };
  }, [dag, run]);

  return (
    <div>
      <div ref={ref} className="h-[300px] w-full rounded-[var(--radius-sm)] border border-[var(--border)]" />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--fg-muted)]">
        <span className="font-medium">填充=结果</span>
        {[["pass", "通过"], ["fail", "发现问题"], ["skip", "跳过"]].map(([k, t]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded" style={{ background: VERDICT_FILL[k], border: `1px solid ${VERDICT_TEXT[k]}` }} /> {t}
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
        <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs">
          <span className="mono font-semibold">{sel.id}</span> · {sel.label} · {sel.layer} · 权限 {sel.auth}
          {sel.v && <> · verdict <b>{sel.v.verdict}</b>{sel.v.cached ? "（缓存）" : ""} · {sel.v.duration_ms}ms</>}
        </div>
      )}
    </div>
  );
}
