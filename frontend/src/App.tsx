import { useEffect, useState } from "react";
import { api } from "./api";
import Dashboard from "./pages/Dashboard";
import Ontology from "./pages/Ontology";
import Rules from "./pages/Rules";
import Process from "./pages/Process";
import MutationLab from "./pages/MutationLab";
import ReviewQueue from "./pages/ReviewQueue";

const TABS = ["总览仪表盘", "本体校验", "规则校验", "流程校验", "错误注入实验室", "审核队列"];

export default function App() {
  const [tab, setTab] = useState(0);
  const [dataset, setDataset] = useState("loan");
  const [datasets, setDatasets] = useState<string[]>([]);
  const [run, setRun] = useState<any>(null);
  const [findings, setFindings] = useState<any[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api("/api/datasets").then((d) => setDatasets(d.datasets));
  }, []);

  async function triggerRun() {
    setRunning(true);
    try {
      const summary = await api(`/api/runs?dataset=${dataset}`, { method: "POST" });
      setRun(summary);
      const f = await api(`/api/runs/${summary.run_id}/findings`);
      setFindings(f.findings);
    } finally {
      setRunning(false);
    }
  }

  async function refreshFindings() {
    if (!run) return;
    const [f, s] = await Promise.all([
      api(`/api/runs/${run.run_id}/findings`),
      api(`/api/runs/${run.run_id}`),
    ]);
    setFindings(f.findings);
    setRun(s);
  }

  const shared = { dataset, run, findings, refreshFindings };
  return (
    <div className="app">
      <div className="panel" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ marginRight: 12 }}>知识校验系统 Demo</strong>
        <select value={dataset} onChange={(e) => setDataset(e.target.value)}>
          {datasets.map((d) => <option key={d}>{d}</option>)}
        </select>
        <button className="btn primary" onClick={triggerRun} disabled={running}>
          {running ? "校验运行中…" : "▶ 运行全管线"}
        </button>
        {run && <span className="muted">run: {run.run_id}（{run.dataset}）</span>}
      </div>
      <div className="tabs">
        {TABS.map((t, i) => (
          <button key={t} className={`tab ${i === tab ? "active" : ""}`}
                  onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>
      {tab === 0 && <Dashboard {...shared} />}
      {tab === 1 && <Ontology {...shared} />}
      {tab === 2 && <Rules {...shared} />}
      {tab === 3 && <Process {...shared} />}
      {tab === 4 && <MutationLab dataset={dataset} />}
      {tab === 5 && <ReviewQueue {...shared} />}
    </div>
  );
}
