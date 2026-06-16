import { Play, Loader2, Database, Cpu, PanelLeft } from "lucide-react";
import { useStore, type Section } from "../store";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import { Pill } from "./ui/Badge";
import { Legend } from "./Legend";

const SECTION_NAME: Record<Section, string> = {
  overview: "总览", inbox: "收件箱", ontology: "本体校验", rules: "规则校验",
  process: "流程校验", lab: "错误注入", gate: "写入闸门",
};

export function RunBar() {
  const { datasets, dataset, setDataset, run, running, triggerRun, judgeBackend, error,
          section, setNavOpen } = useStore();
  return (
    <header className="flex flex-col gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-2.5">
      <div className="flex items-center gap-3">
        <button onClick={() => setNavOpen(true)} title="菜单"
          className="-ml-1 flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--fg-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]">
          <PanelLeft size={17} />
          <span className="text-sm font-semibold">{SECTION_NAME[section]}</span>
        </button>
        <div className="h-4 w-px bg-[var(--border)]" />
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
