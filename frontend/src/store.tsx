import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Finding, type RunSummary } from "./api";

export type Section = "overview" | "inbox" | "ontology" | "rules" | "process" | "lab" | "gate";

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
  triggerRun: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [datasets, setDatasets] = useState<string[]>([]);
  const [dataset, setDataset] = useState("loan");
  const [section, setSection] = useState<Section>("overview");
  const [run, setRun] = useState<RunSummary | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [running, setRunning] = useState(false);
  const [judgeBackend, setJudgeBackend] = useState("—");

  useEffect(() => {
    api("/api/datasets").then((d) => setDatasets(d.datasets)).catch(() => {});
    api("/api/judge/config").then((c) => setJudgeBackend(c.active_backend)).catch(() => {});
  }, []);

  async function triggerRun() {
    setRunning(true);
    try {
      const summary: RunSummary = await api(`/api/runs?dataset=${dataset}`, { method: "POST" });
      setRun(summary);
      const f = await api(`/api/runs/${summary.run_id}/findings`);
      setFindings(f.findings);
    } finally {
      setRunning(false);
    }
  }

  async function refresh() {
    if (!run) return;
    const [f, s] = await Promise.all([
      api(`/api/runs/${run.run_id}/findings`),
      api(`/api/runs/${run.run_id}`),
    ]);
    setFindings(f.findings);
    setRun(s);
  }

  return (
    <Ctx.Provider value={{ datasets, dataset, setDataset, section, setSection,
      run, findings, running, judgeBackend, triggerRun, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
