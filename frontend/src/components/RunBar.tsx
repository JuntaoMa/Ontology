import { Play, Loader2, Database, Cpu } from "lucide-react";
import { useStore } from "../store";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import { Pill } from "./ui/Badge";
import { Legend } from "./Legend";

export function RunBar() {
  const { datasets, dataset, setDataset, run, running, triggerRun, judgeBackend, error } = useStore();
  return (
    <header className="flex flex-col gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-[var(--fg-subtle)]">
          <Database size={14} />
          <Select value={dataset} onChange={(e) => setDataset(e.target.value)} disabled={running}>
            {datasets.map((d) => <option key={d}>{d}</option>)}
          </Select>
        </div>
        <Button variant="primary" onClick={triggerRun} disabled={running}>
          {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {running ? "校验运行中…" : "运行全管线"}
        </Button>
        {run && <span className="mono text-xs text-[var(--fg-subtle)]">run {run.run_id}</span>}
        <div className="ml-auto flex items-center gap-2 text-xs text-[var(--fg-subtle)]">
          <Cpu size={13} />
          <Pill tone={judgeBackend === "cassette" ? "neutral" : "accent"}>
            judge: {judgeBackend}
          </Pill>
        </div>
      </div>
      {error && (
        <div className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs"
             style={{ borderColor: "var(--sev-violation)", background: "var(--sev-violation-soft)",
                      color: "var(--sev-violation)" }}>
          {error}
        </div>
      )}
      <Legend />
    </header>
  );
}
