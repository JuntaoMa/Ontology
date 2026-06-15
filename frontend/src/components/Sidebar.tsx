import { LayoutDashboard, Inbox, Network, Scale, GitBranch, FlaskConical, DoorOpen } from "lucide-react";
import { useStore, type Section } from "../store";
import { cn } from "../lib/cn";

const NAV: { id: Section; label: string; Icon: any }[] = [
  { id: "overview", label: "总览", Icon: LayoutDashboard },
  { id: "inbox", label: "收件箱", Icon: Inbox },
  { id: "ontology", label: "本体校验", Icon: Network },
  { id: "rules", label: "规则校验", Icon: Scale },
  { id: "process", label: "流程校验", Icon: GitBranch },
  { id: "lab", label: "错误注入", Icon: FlaskConical },
  { id: "gate", label: "写入闸门", Icon: DoorOpen },
];

export function Sidebar() {
  const { section, setSection, run, findings } = useStore();
  const openCount = findings.filter((f) => f.status === "open").length;

  return (
    <aside className="flex w-[200px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-bold">✓</div>
        <div className="text-sm font-semibold leading-tight">知识校验<br /><span className="text-[var(--fg-subtle)] font-normal">Validation Studio</span></div>
      </div>
      <nav className="flex flex-col gap-0.5 px-2 py-2">
        {NAV.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setSection(id)}
            className={cn(
              "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm transition-colors",
              section === id
                ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                : "text-[var(--fg-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]")}>
            <Icon size={16} />
            <span className="flex-1 text-left">{label}</span>
            {id === "inbox" && run && openCount > 0 && (
              <span className="rounded-full bg-[var(--fg-subtle)]/15 px-1.5 text-[11px] tabular-nums text-[var(--fg-muted)]">{openCount}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="mt-auto px-4 py-3 text-[11px] text-[var(--fg-subtle)]">
        确定性引擎 + LLM judge<br />混合校验 demo
      </div>
    </aside>
  );
}
