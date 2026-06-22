import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Finding, type RunSummary } from "./api";

export type Section = "overview" | "inbox" | "ontology" | "rules" | "process" | "lab" | "gate" | "about";

export interface Scenario {
  id: string;
  label: string;
  change_set: string[] | null;
  desc: string;
}

interface Store {
  datasets: string[];
  dataset: string;
  setDataset: (d: string) => void;
  section: Section;
  setSection: (s: Section) => void;
  run: RunSummary | null;
  findings: Finding[];
  running: boolean;
  judgeBackend: string;
  error: string | null;
  scenarios: Scenario[];
  scenario: string;            // 选中的 change-set 场景 id（默认 full）
  setScenario: (s: string) => void;
  triggerRun: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

async function loadFindings(runId: string) {
  const f = await api(`/api/runs/${runId}/findings`);
  return f.findings as Finding[];
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [datasets, setDatasets] = useState<string[]>([]);
  const [dataset, setDataset] = useState("loan");
  const [section, setSection] = useState<Section>("overview");
  const [run, setRun] = useState<RunSummary | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [running, setRunning] = useState(false);
  const [judgeBackend, setJudgeBackend] = useState("—");
  const [error, setError] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenario, setScenario] = useState("full");

  useEffect(() => {
    api("/api/datasets").then((d) => setDatasets(d.datasets)).catch(() => {});
    api("/api/judge/config").then((c) => setJudgeBackend(c.active_backend)).catch(() => {});
    api("/api/pipeline/scopes").then((d) => setScenarios(d.scenarios)).catch(() => {});
    // 刷新后恢复最近一次 run（结果存后端，不随页面刷新丢失）
    api("/api/runs/latest").then(async (s) => {
      if (s && s.run_id) {
        setRun(s);
        setDataset(s.dataset);
        setFindings(await loadFindings(s.run_id));
      }
    }).catch(() => {});
  }, []);

  async function triggerRun() {
    setRunning(true);
    setError(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const cs = scenarios.find((s) => s.id === scenario)?.change_set;
      const scopeQ = cs && cs.length ? `&scope=${cs.join(",")}` : "";
      const summary: RunSummary = await api(
        `/api/runs?dataset=${dataset}${scopeQ}`, { method: "POST", signal: ctrl.signal });
      setRun(summary);
      setFindings(await loadFindings(summary.run_id));
    } catch (e: any) {
      setError(e?.name === "AbortError"
        ? "运行超时（>120s）。请确认前端访问的端口就是后端端口（同源）；若用 npm run dev，需把 vite 代理指向后端端口。"
        : `运行失败：${e?.message || e}`);
    } finally {
      clearTimeout(timer);
      setRunning(false);
    }
  }

  async function refresh() {
    if (!run) return;
    const [f, s] = await Promise.all([
      loadFindings(run.run_id),
      api(`/api/runs/${run.run_id}`),
    ]);
    setFindings(f);
    setRun(s);
  }

  return (
    <Ctx.Provider value={{ datasets, dataset, setDataset, section, setSection,
      run, findings, running, judgeBackend, error,
      scenarios, scenario, setScenario, triggerRun, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
